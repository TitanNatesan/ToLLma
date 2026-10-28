"""Prompt logging settings: effective read + versioned upsert.

Personal rows are owner-only; org rows need ACTIVE membership + the
per-endpoint PromptLogs.* permission. Every miss is a 404 oracle.
"""

import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from tollms.api.orgs.common.audit import _audit
from tollms.api.orgs.common.guards import _member_org, _require_perm
from tollms.core.crypto import decrypt
from tollms.core.exceptions import (
    ApplicationException,
    NotFoundError,
    ValidationError,
)
from tollms.models.api_key import ApiKey
from tollms.models.organization import Team
from tollms.models.prompt_logging import (
    MODES,
    PromptLoggingKeyOverride,
    PromptLoggingKeyTarget,
    PromptLoggingSetting,
    PromptLoggingTeamTarget,
)

logger = logging.getLogger(__name__)

DEFAULT_RETENTION_DAYS = 90
MAX_TARGETS = 100


def _scope(db: Session, caller_id: uuid.UUID, org_id: uuid.UUID | None,
           code: str) -> None:
    if org_id is None:
        return
    org, mem = _member_org(db, org_id, caller_id)
    _require_perm(db, org, mem, caller_id, code)


def _live_setting(db: Session, caller_id: uuid.UUID,
                  org_id: uuid.UUID | None) -> PromptLoggingSetting | None:
    stmt = select(PromptLoggingSetting).where(PromptLoggingSetting.is_deleted.is_(False))
    if org_id is None:
        stmt = stmt.where(PromptLoggingSetting.org_id.is_(None),
                          PromptLoggingSetting.user_id == caller_id)
    else:
        stmt = stmt.where(PromptLoggingSetting.org_id == org_id)
    return db.scalar(stmt)


def _team_ids(db: Session, setting_id: uuid.UUID) -> list[uuid.UUID]:
    return list(db.scalars(
        select(PromptLoggingTeamTarget.team_id).where(
            PromptLoggingTeamTarget.setting_id == setting_id)))


def _key_ids(db: Session, setting_id: uuid.UUID) -> list[str]:
    return [str(k) for k in db.scalars(
        select(PromptLoggingKeyTarget.api_key_id).where(
            PromptLoggingKeyTarget.setting_id == setting_id))]


def _team_states(db: Session, setting_id: uuid.UUID) -> dict[str, bool]:
    rows = db.execute(
        select(PromptLoggingTeamTarget.team_id, PromptLoggingTeamTarget.enabled).where(
            PromptLoggingTeamTarget.setting_id == setting_id)).all()
    return {str(tid): bool(enabled) for tid, enabled in rows}


def _key_states(db: Session, setting_id: uuid.UUID,
                key_ids: list[str]) -> dict[str, bool | None]:
    """Effective per-key state for every listed key: the explicit override
    value, or True (inherit defaults to on for listed ids)."""
    overrides = dict(db.execute(
        select(PromptLoggingKeyOverride.api_key_id,
               PromptLoggingKeyOverride.enabled).where(
            PromptLoggingKeyOverride.setting_id == setting_id)).all())
    states: dict[str, bool | None] = {}
    for kid in key_ids:
        parsed = uuid.UUID(kid)
        if parsed in overrides:
            value = overrides[parsed]
            states[kid] = None if value is None else bool(value)
        else:
            states[kid] = True
    return states


def _summary(setting: PromptLoggingSetting | None,
             team_ids: list[uuid.UUID],
             team_states: dict[str, bool] | None = None,
             key_states: dict[str, bool | None] | None = None) -> dict:
    if setting is None:
        return {"enabled": False, "capture": "none", "mandatory": False,
                "scope": "all", "retention_days": DEFAULT_RETENTION_DAYS}
    if not setting.enabled:
        capture = "none"
    elif setting.capture_input and setting.capture_output:
        capture = "full"
    elif setting.capture_input:
        capture = "input"
    elif setting.capture_output:
        capture = "output"
    else:
        capture = "metadata"
    if (setting.mode or "global") == "global":
        scope: object = "all"
    else:
        # Enabled-only (mirrors resolution._target_team_ids enabled=True):
        # disabled teams/keys never count toward scope.
        states = team_states or {}
        enabled_teams = sum(1 for tid in team_ids if states.get(str(tid), True) is True)
        if key_states:
            enabled_keys = sum(1 for v in key_states.values() if v is not False)
            scope = {"teams": enabled_teams, "keys": enabled_keys}
        else:
            scope = {"teams": enabled_teams}
    mandatory = bool(setting.enabled) and (setting.mode or "global") == "global"
    return {"enabled": bool(setting.enabled), "capture": capture,
            "mandatory": mandatory, "scope": scope,
            "retention_days": setting.retention_days}


def read_setting(db: Session, setting: PromptLoggingSetting | None,
                 caller_id: uuid.UUID, org_id: uuid.UUID | None):
    """Materialize SettingsRead; absent rows surface as a disabled default."""
    from tollms.api.prompt_logging.schemas import SettingsRead

    now = datetime.now(timezone.utc)
    if setting is None:
        return SettingsRead(
            id=uuid.uuid4(), user_id=None if org_id else caller_id, org_id=org_id,
            enabled=False, mode="global", capture_input=False, capture_output=False,
            retention_days=DEFAULT_RETENTION_DAYS, version=0, updated_by=None,
            team_ids=[], key_ids=[], team_states={}, key_states={},
            effective_summary=_summary(None, []),
            created_at=now, updated_at=now)
    teams = _team_ids(db, setting.id)
    keys = _key_ids(db, setting.id)
    t_states = _team_states(db, setting.id)
    k_states = _key_states(db, setting.id, keys)
    return SettingsRead(
        id=setting.id, user_id=setting.user_id, org_id=setting.org_id,
        enabled=setting.enabled, mode=setting.mode,
        capture_input=setting.capture_input, capture_output=setting.capture_output,
        retention_days=setting.retention_days, version=setting.version,
        updated_by=setting.updated_by, team_ids=teams, key_ids=keys,
        team_states=t_states,
        key_states=k_states,
        effective_summary=_summary(setting, teams, t_states, k_states),
        created_at=setting.created_at, updated_at=setting.updated_at)


def get_settings(db: Session, caller_id: uuid.UUID, org_id: uuid.UUID | None):
    _scope(db, caller_id, org_id, "PromptLogs.Read")
    return read_setting(db, _live_setting(db, caller_id, org_id), caller_id, org_id)


def _validate_teams(db: Session, org_id: uuid.UUID, team_ids: list[uuid.UUID]) -> None:
    if len(team_ids) > MAX_TARGETS:
        raise ValidationError(f"team_ids: at most {MAX_TARGETS}")
    if not team_ids:
        return
    rows = db.scalars(select(Team).where(
        Team.id.in_(team_ids), Team.is_deleted.is_(False))).all()
    by_id = {row.id: row for row in rows}
    for team_id in team_ids:
        team = by_id.get(team_id)
        if team is None or team.org_id != org_id:
            raise NotFoundError("prompt log not found")


def _validate_keys(db: Session, caller_id: uuid.UUID, org_id: uuid.UUID | None,
                   key_ids: list[str]) -> list[uuid.UUID]:
    """Parse + workspace-pin every key target. Anything off — malformed id,
    missing/deleted row, or a key from another workspace (personal callers
    need key.org_id IS NULL and key.user_id == caller; org callers need
    key.org_id == org_id) — is the same generic 404 oracle (no existence or
    ownership leak)."""
    if len(key_ids) > MAX_TARGETS:
        raise ValidationError(f"key_ids: at most {MAX_TARGETS}")
    parsed: list[uuid.UUID] = []
    for raw in key_ids:
        try:
            parsed.append(uuid.UUID(str(raw)))
        except (ValueError, TypeError, AttributeError):
            raise NotFoundError("prompt log not found") from None
    if not parsed:
        return []
    rows = db.scalars(select(ApiKey).where(ApiKey.id.in_(parsed))).all()
    by_id = {row.id: row for row in rows}
    for kid in parsed:
        key = by_id.get(kid)
        if key is None or key.is_deleted:
            raise NotFoundError("prompt log not found")
        if org_id is None:
            if key.org_id is not None or key.user_id != caller_id:
                raise NotFoundError("prompt log not found")
        elif key.org_id != org_id:
            raise NotFoundError("prompt log not found")
    return list(dict.fromkeys(parsed))


def _parse_team_states(raw: dict, team_ids: list[uuid.UUID]) -> dict[str, bool]:
    """team_states keys must be listed team_ids (absent = default True).
    Malformed UUIDs are 404 oracles (no existence leak); unlisted ids are
    422 (same-request client error)."""
    listed = {str(tid) for tid in team_ids}
    states: dict[str, bool] = {}
    for key, value in raw.items():
        try:
            parsed = str(uuid.UUID(str(key)))
        except (ValueError, TypeError, AttributeError):
            raise NotFoundError("prompt log not found") from None
        if parsed not in listed:
            raise ValidationError("team_states must reference listed team_ids")
        states[parsed] = bool(value)
    return states


def _parse_key_states(raw: dict, key_ids: list[uuid.UUID]) -> dict[str, bool | None]:
    """key_states keys must be listed key_ids (absent = default True).
    Malformed UUIDs are 404 oracles; unlisted ids are 422."""
    listed = {str(kid) for kid in key_ids}
    states: dict[str, bool | None] = {}
    for key, value in raw.items():
        try:
            parsed = str(uuid.UUID(str(key)))
        except (ValueError, TypeError, AttributeError):
            raise NotFoundError("prompt log not found") from None
        if parsed not in listed:
            raise ValidationError("key_states must reference listed key_ids")
        states[parsed] = None if value is None else bool(value)
    return states


def _reject_weakened_global(enabled: bool, mode: str,
                            team_states: dict[str, bool],
                            key_states: dict[str, bool | None]) -> None:
    """A global mandatory policy cannot be weakened: while the resulting
    setting is enabled in global mode, any explicit team/key force-off is
    422 — including forged requests. Inherit (null) is not a disable."""
    if enabled and (mode or "global") == "global":
        if any(v is False for v in team_states.values()):
            raise ValidationError("team_states cannot disable while global capture is enabled")
        if any(v is False for v in key_states.values()):
            raise ValidationError("key_states cannot disable while global capture is enabled")


def upsert_settings(db: Session, caller_id: uuid.UUID, data) :
    """Create-or-update the workspace setting (versioned). Org writes audit
    in the SAME committing transaction (single db.commit; an audit failure
    rolls back and surfaces 500, never a silent success). Personal writes
    skip audit by design. Global mode clears stored team+key targets."""
    org_id = data.org_id
    _scope(db, caller_id, org_id, "PromptLogs.Manage")
    mode = (data.mode or "global").lower()
    if mode not in MODES:
        # Truncated: the value is attacker-controlled (request body).
        raise ValidationError(f"invalid mode: {str(data.mode)[:32]!r}")
    setting = _live_setting(db, caller_id, org_id)
    if "retention_days" in data.model_fields_set:
        # Explicit null = keep forever; absent = create: 90 / update: keep.
        retention = data.retention_days
        if retention is not None and not 1 <= retention <= 3650:
            raise ValidationError(f"invalid retention_days: {retention!r}")
    else:
        retention = setting.retention_days if setting is not None else DEFAULT_RETENTION_DAYS
    team_ids = list(data.team_ids or [])
    key_inputs = list(data.key_ids or [])
    if org_id is not None:
        _validate_teams(db, org_id, team_ids)
    elif team_ids:
        raise ValidationError("team_ids require an organization workspace")
    key_ids = _validate_keys(db, caller_id, org_id, key_inputs)
    team_states = _parse_team_states(data.team_states or {}, team_ids)
    key_states = _parse_key_states(data.key_states or {}, key_ids)
    if org_id is None and team_states:
        raise ValidationError("team_states require an organization workspace")
    _reject_weakened_global(bool(data.enabled), mode, team_states, key_states)
    if mode == "global":
        # Global matches everything: stored targets are cleared (return empties).
        team_ids, key_ids = [], []
        team_states, key_states = {}, {}

    if setting is None:
        setting = PromptLoggingSetting(
            user_id=None if org_id else caller_id, org_id=org_id,
            enabled=bool(data.enabled), mode=mode,
            capture_input=bool(data.capture_input), capture_output=bool(data.capture_output),
            retention_days=(retention if retention is not None
                            else DEFAULT_RETENTION_DAYS),
            version=1, updated_by=caller_id)
        db.add(setting)
        db.flush()
        if retention is None:
            # Column default=90 fires on None at INSERT; NULL it back so an
            # explicit null (keep forever) persists on new rows.
            setting.retention_days = None
    else:
        setting.enabled = bool(data.enabled)
        setting.mode = mode
        setting.capture_input = bool(data.capture_input)
        setting.capture_output = bool(data.capture_output)
        setting.retention_days = retention
        setting.version = (setting.version or 1) + 1
        setting.updated_by = caller_id
        for row in list(setting.targets or []):
            db.delete(row)
        for row in list(setting.key_targets or []):
            db.delete(row)
        for row in list(setting.key_overrides or []):
            db.delete(row)
        db.flush()
    for team_id in team_ids:
        db.add(PromptLoggingTeamTarget(
            setting_id=setting.id, team_id=team_id,
            enabled=team_states.get(str(team_id), True)))
    for kid in key_ids:
        db.add(PromptLoggingKeyTarget(setting_id=setting.id, api_key_id=kid))
        state = key_states.get(str(kid))
        if state is not None:
            db.add(PromptLoggingKeyOverride(
                setting_id=setting.id, api_key_id=kid, enabled=state))
    db.flush()
    try:
        if org_id is not None:
            _audit(db, org_id, caller_id, "prompt_logs.settings.update",
                   setting_id=str(setting.id), enabled=bool(setting.enabled), mode=mode)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ValidationError("prompt logging setting conflict") from None
    except ApplicationException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise ApplicationException("prompt logging settings update failed") from exc
    db.refresh(setting)
    # Disabling never auto-deletes: rows and targets persist untouched.
    return read_setting(db, setting, caller_id, org_id)


def _mandatory_guard(setting: PromptLoggingSetting, enabled_value: bool | None) -> None:
    """Sub-endpoint parity with PUT /settings: an explicit force-off while
    the setting is enabled in global mode is 422 (mandatory not weakenable)."""
    if (enabled_value is False and setting.enabled
            and (setting.mode or "global") == "global"):
        raise ValidationError("cannot disable while global capture is enabled")


def _touch_setting(db: Session, setting: PromptLoggingSetting,
                   caller_id: uuid.UUID) -> None:
    setting.version = (setting.version or 1) + 1
    setting.updated_by = caller_id
    db.flush()


def set_team_state(db: Session, caller_id: uuid.UUID, org_id: uuid.UUID | None,
                   team_id: uuid.UUID, enabled: bool):
    """Force one listed team on/off. Manage-gated; unknown/cross-workspace
    teams, unlisted teams, and missing settings are the same 404 oracle."""
    _scope(db, caller_id, org_id, "PromptLogs.Manage")
    if org_id is None:
        raise NotFoundError("prompt log not found")  # personal has no teams
    team = db.get(Team, team_id)
    if team is None or team.is_deleted or team.org_id != org_id:
        raise NotFoundError("prompt log not found")
    setting = _live_setting(db, caller_id, org_id)
    if setting is None:
        raise NotFoundError("prompt log not found")
    _mandatory_guard(setting, enabled)
    row = db.scalar(select(PromptLoggingTeamTarget).where(
        PromptLoggingTeamTarget.setting_id == setting.id,
        PromptLoggingTeamTarget.team_id == team_id))
    if row is None:
        raise NotFoundError("prompt log not found")
    row.enabled = bool(enabled)
    _touch_setting(db, setting, caller_id)
    try:
        _audit(db, org_id, caller_id, "prompt_logs.settings.update",
               setting_id=str(setting.id), enabled=bool(setting.enabled),
               mode=setting.mode)
        db.commit()
    except ApplicationException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise ApplicationException("prompt logging settings update failed") from exc
    db.refresh(setting)
    return read_setting(db, setting, caller_id, org_id)


def set_key_state(db: Session, caller_id: uuid.UUID, org_id: uuid.UUID | None,
                  key_id: uuid.UUID, enabled: bool | None):
    """Force one listed key on/off/inherit (null deletes the override row).
    Manage-gated; unknown/cross-workspace keys, unlisted keys, and missing
    settings are the same 404 oracle."""
    _scope(db, caller_id, org_id, "PromptLogs.Manage")
    _validate_keys(db, caller_id, org_id, [str(key_id)])  # 404 oracle
    setting = _live_setting(db, caller_id, org_id)
    if setting is None:
        raise NotFoundError("prompt log not found")
    _mandatory_guard(setting, enabled)
    listed = db.scalar(select(PromptLoggingKeyTarget.id).where(
        PromptLoggingKeyTarget.setting_id == setting.id,
        PromptLoggingKeyTarget.api_key_id == key_id))
    if listed is None:
        raise NotFoundError("prompt log not found")
    row = db.scalar(select(PromptLoggingKeyOverride).where(
        PromptLoggingKeyOverride.setting_id == setting.id,
        PromptLoggingKeyOverride.api_key_id == key_id))
    if enabled is None:
        if row is not None:
            db.delete(row)
    elif row is None:
        db.add(PromptLoggingKeyOverride(
            setting_id=setting.id, api_key_id=key_id, enabled=bool(enabled)))
    else:
        row.enabled = bool(enabled)
    _touch_setting(db, setting, caller_id)
    try:
        if org_id is not None:
            _audit(db, org_id, caller_id, "prompt_logs.settings.update",
                   setting_id=str(setting.id), enabled=bool(setting.enabled),
                   mode=setting.mode)
        db.commit()
    except ApplicationException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise ApplicationException("prompt logging settings update failed") from exc
    db.refresh(setting)
    return read_setting(db, setting, caller_id, org_id)


def list_teams(db: Session, caller_id: uuid.UUID, org_id: uuid.UUID | None):
    """Org team list for settings viewers (PromptLogs.Read). Personal has none."""
    from tollms.api.prompt_logging.schemas import TeamRef

    if org_id is None:
        return []
    _scope(db, caller_id, org_id, "PromptLogs.Read")
    rows = db.scalars(select(Team).where(
        Team.org_id == org_id, Team.is_deleted.is_(False)).order_by(Team.name)).all()
    return [TeamRef(id=row.id, name=row.name) for row in rows]


def decrypt_body(cipher: str | None) -> str | None:
    if not cipher:
        return None
    try:
        return decrypt(cipher)
    except Exception:
        logger.warning("promptlog body undecryptable", exc_info=True)
        return None
