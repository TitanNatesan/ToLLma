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


def _summary(setting: PromptLoggingSetting | None,
             team_ids: list[uuid.UUID]) -> dict:
    if setting is None:
        return {"enabled": False, "capture": "none",
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
    scope = "all" if (setting.mode or "global") == "global" else {"teams": len(team_ids)}
    return {"enabled": bool(setting.enabled), "capture": capture,
            "scope": scope, "retention_days": setting.retention_days}


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
            team_ids=[], key_ids=[], effective_summary=_summary(None, []),
            created_at=now, updated_at=now)
    teams = _team_ids(db, setting.id)
    return SettingsRead(
        id=setting.id, user_id=setting.user_id, org_id=setting.org_id,
        enabled=setting.enabled, mode=setting.mode,
        capture_input=setting.capture_input, capture_output=setting.capture_output,
        retention_days=setting.retention_days, version=setting.version,
        updated_by=setting.updated_by, team_ids=teams, key_ids=_key_ids(db, setting.id),
        effective_summary=_summary(setting, teams),
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
            raise ValidationError(f"team {team_id} does not belong to this organization")


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
    retention = data.retention_days if data.retention_days is not None else DEFAULT_RETENTION_DAYS
    if not 1 <= retention <= 3650:
        raise ValidationError(f"invalid retention_days: {retention!r}")
    team_ids = list(data.team_ids or [])
    key_inputs = list(data.key_ids or [])
    if org_id is not None:
        _validate_teams(db, org_id, team_ids)
    elif team_ids:
        raise ValidationError("team_ids require an organization workspace")
    key_ids = _validate_keys(db, caller_id, org_id, key_inputs)
    if mode == "global":
        # Global matches everything: stored targets are cleared (return empties).
        team_ids, key_ids = [], []

    setting = _live_setting(db, caller_id, org_id)
    if setting is None:
        setting = PromptLoggingSetting(
            user_id=None if org_id else caller_id, org_id=org_id,
            enabled=bool(data.enabled), mode=mode,
            capture_input=bool(data.capture_input), capture_output=bool(data.capture_output),
            retention_days=retention, version=1, updated_by=caller_id)
        db.add(setting)
        db.flush()
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
        db.flush()
    for team_id in team_ids:
        db.add(PromptLoggingTeamTarget(setting_id=setting.id, team_id=team_id))
    for kid in key_ids:
        db.add(PromptLoggingKeyTarget(setting_id=setting.id, api_key_id=kid))
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
