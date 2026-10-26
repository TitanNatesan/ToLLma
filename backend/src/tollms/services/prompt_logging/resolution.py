"""Prompt-log policy resolution: which setting governs one call.

Server-enforced semantics (this module is authoritative):

1. Workspace pin FIRST via _derive_provenance (unchanged order — the key
   row is authoritative whenever it resolves; the hint only applies when
   there is no key row). A key-lookup exception yields the ("unknown", None)
   sentinel, which resolves to no-capture (never guess personal).
2. Setting disabled (or absent) -> no-capture.
3. mode == global -> match (match_source="global"); allow-list targets are
   ignored entirely. While a setting is enabled in global mode the API
   refuses any explicit disable (team/key force-off is 422) — a global
   mandatory policy cannot be weakened, including via forged requests.
4. mode == teams -> hierarchical enablement over the two allow-lists:
     a. Per-key override (NULL/absent = inherit = default True for listed
        keys): False vetoes capture even when a team hits; True captures
        (match_source="key") even without a team hit.
     b. Otherwise (inherit): team_hit (caller's ACTIVE team memberships
        intersect the setting's ENABLED team targets; multi-team = OR) OR
        key_hit (the call's api_key_id is a live, non-deleted entry in the
        setting's key targets). Revoked or disabled keys fail auth upstream
        anyway, so the ledger checks deletion only. match_source is "team"
        (team leg hit; takes precedence when both hit) or "key".
5. Teams mode with no enabled team targets AND no eligible key -> no-capture
   (never falls through to global). Personal workspaces have no teams: only
   the key leg (override or listed key) or global mode can match.

Personal-key/user traffic resolves ONLY the personal setting of that user;
org-key traffic resolves ONLY the org setting of the key's org. An org
policy never governs personal-key traffic. Unscoped legacy traffic (user,
no key, internal) resolves the personal setting of the user. Never raises
(fail-closed to no-capture).
"""

import logging
import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from tollms.models.prompt_logging import (
    PromptLoggingKeyOverride,
    PromptLoggingSetting,
    PromptLoggingTeamTarget,
)

logger = logging.getLogger(__name__)


@dataclass
class ResolvedSetting:
    setting: PromptLoggingSetting | None = None
    team_ids: list[str] | None = None
    match_source: str | None = None


def _live_setting_for_user(db: Session, user_id: uuid.UUID) -> PromptLoggingSetting | None:
    try:
        return db.scalar(
            select(PromptLoggingSetting).where(
                PromptLoggingSetting.is_deleted.is_(False),
                PromptLoggingSetting.org_id.is_(None),
                PromptLoggingSetting.user_id == user_id,
            )
        )
    except Exception:
        logger.warning("promptlog user setting lookup failed", exc_info=True)
        return None


def _live_setting_for_org(db: Session, org_id: uuid.UUID) -> PromptLoggingSetting | None:
    try:
        return db.scalar(
            select(PromptLoggingSetting).where(
                PromptLoggingSetting.is_deleted.is_(False),
                PromptLoggingSetting.org_id == org_id,
            )
        )
    except Exception:
        logger.warning("promptlog org setting lookup failed", exc_info=True)
        return None


def _user_team_ids(db: Session, org_id: uuid.UUID, user_id: uuid.UUID) -> set[uuid.UUID]:
    """Team ids the user belongs to in this org (ACTIVE membership only)."""
    from tollms.models.organization import Membership, MembershipState, Team, TeamMembership

    try:
        rows = db.execute(
            select(TeamMembership.team_id)
            .join(Membership, Membership.id == TeamMembership.membership_id)
            .join(Team, Team.id == TeamMembership.team_id)
            .where(
                Membership.org_id == org_id,
                Membership.user_id == user_id,
                Membership.is_deleted.is_(False),
                Membership.state == MembershipState.ACTIVE.value,
                Team.org_id == org_id,
                Team.is_deleted.is_(False),
            )
        ).all()
        return {row[0] for row in rows}
    except Exception:
        logger.warning("promptlog team lookup failed", exc_info=True)
        return set()


def _target_team_ids(db: Session, setting_id: uuid.UUID) -> list[uuid.UUID]:
    """ENABLED team targets only: enabled=False removes the team from the
    match set without deleting the row. Lookup failures fail closed."""
    try:
        return list(
            db.scalars(
                select(PromptLoggingTeamTarget.team_id).where(
                    PromptLoggingTeamTarget.setting_id == setting_id,
                    PromptLoggingTeamTarget.enabled.is_(True),
                )
            )
        )
    except Exception:
        logger.warning("promptlog target lookup failed", exc_info=True)
        return []


def _key_override(db: Session, setting_id: uuid.UUID,
                  api_key_id: uuid.UUID | None) -> bool | None:
    """Explicit per-key override (True/False) or None (inherit). Fail-closed
    to inherit on lookup errors — a DB blip must not veto or force capture."""
    if api_key_id is None:
        return None
    try:
        return db.scalar(
            select(PromptLoggingKeyOverride.enabled).where(
                PromptLoggingKeyOverride.setting_id == setting_id,
                PromptLoggingKeyOverride.api_key_id == api_key_id,
            )
        )
    except Exception:
        logger.warning("promptlog key-override lookup failed", exc_info=True)
        return None


def _target_key_ids(db: Session, setting_id: uuid.UUID) -> list[uuid.UUID]:
    """Key allow-list for a setting (teams mode). Lookup failures fail
    closed to an empty list via the caller (no match -> no capture)."""
    from tollms.models.prompt_logging import PromptLoggingKeyTarget

    try:
        return list(
            db.scalars(
                select(PromptLoggingKeyTarget.api_key_id).where(
                    PromptLoggingKeyTarget.setting_id == setting_id
                )
            )
        )
    except Exception:
        logger.warning("promptlog key-target lookup failed", exc_info=True)
        return []


def _key_live(db: Session, api_key_id: uuid.UUID) -> bool:
    """A target key counts only while its row is live (not soft-deleted).
    Revoked/disabled keys fail auth upstream anyway, so deletion is the
    only ledger-side liveness check."""
    from tollms.models.api_key import ApiKey

    try:
        return (
            db.scalar(
                select(ApiKey.id).where(
                    ApiKey.id == api_key_id, ApiKey.is_deleted.is_(False)
                )
            )
            is not None
        )
    except Exception:
        logger.warning("promptlog key liveness lookup failed", exc_info=True)
        return False


def _derive_provenance(
    db: Session, api_key_id: uuid.UUID | None, hint: str | None
) -> tuple[str, uuid.UUID | None]:
    """(provenance, org_id): the key row is authoritative whenever it
    resolves — a stale/mismatched hint (provider-org-A hint with a key-org-B
    row) must never divert the ledger. The hint only applies when there is
    no key row to consult (deleted key, unkeyed traffic). A key-lookup
    *exception* yields the ("unknown", None) sentinel so resolution fails
    closed to no-capture instead of guessing personal."""
    if api_key_id is not None:
        try:
            from tollms.models.api_key import ApiKey

            key = db.get(ApiKey, api_key_id)
            if key is not None:
                if key.org_id is not None:
                    return "organization", key.org_id
                return "personal", None
        except Exception:
            logger.warning("promptlog key provenance lookup failed", exc_info=True)
            return "unknown", None
    if hint in ("personal", "organization"):
        return hint, None
    return "personal", None


def _match_teams_mode(
    db: Session,
    setting: PromptLoggingSetting,
    scope_org: uuid.UUID | None,
    user_id: uuid.UUID,
    api_key_id: uuid.UUID | None,
) -> ResolvedSetting:
    """Shared teams-mode matcher (hierarchical enablement).

    Key override wins: False vetoes everything, True captures as key. On
    inherit, team_hit (OR across enabled targets) or listed-live key_hit
    captures; team takes precedence when both hit. Empty/disabled target
    lists match nothing (never fall back to global)."""
    override = _key_override(db, setting.id, api_key_id)
    if override is False:
        return ResolvedSetting()
    if override is True:
        return ResolvedSetting(setting=setting, team_ids=[], match_source="key")
    targets = _target_team_ids(db, setting.id)
    key_targets = _target_key_ids(db, setting.id)
    if not targets and not key_targets:
        return ResolvedSetting()
    mine = _user_team_ids(db, scope_org, user_id) if scope_org is not None else set()
    matched = [str(t) for t in targets if t in mine]
    key_hit = (
        api_key_id is not None
        and api_key_id in set(key_targets)
        and _key_live(db, api_key_id)
    )
    if not matched and not key_hit:
        return ResolvedSetting()
    return ResolvedSetting(
        setting=setting,
        team_ids=matched,
        match_source="team" if matched else "key",
    )


def resolve_setting(
    db: Session,
    *,
    user_id: uuid.UUID | None,
    org_id: uuid.UUID | None = None,
    api_key_id: uuid.UUID | None = None,
    key_provenance: str | None = None,
) -> ResolvedSetting:
    """Return the setting governing one call, or an empty resolution.

    Org provenance resolves the org setting of the key's org (org_id param is
    a hint; the key row wins). Everything else resolves the personal setting
    of user_id. Global mode matches everything under the setting; teams mode
    additionally requires the team or key allow-list to hit — an empty target
    list logs nothing, never falls back to global. Never raises (fail-closed
    to no-capture).
    """
    try:
        provenance, key_org = _derive_provenance(db, api_key_id, key_provenance)
        if provenance == "unknown":
            return ResolvedSetting()
        if provenance == "organization":
            scope_org = key_org if key_org is not None else org_id
            if scope_org is None or user_id is None:
                return ResolvedSetting()
            setting = _live_setting_for_org(db, scope_org)
            if setting is None or not setting.enabled:
                return ResolvedSetting()
            if (setting.mode or "global") == "global":
                return ResolvedSetting(setting=setting, team_ids=None, match_source="global")
            return _match_teams_mode(db, setting, scope_org, user_id, api_key_id)
        if user_id is None:
            return ResolvedSetting()
        setting = _live_setting_for_user(db, user_id)
        if setting is None or not setting.enabled:
            return ResolvedSetting()
        if (setting.mode or "global") == "global":
            return ResolvedSetting(setting=setting, team_ids=None, match_source="global")
        return _match_teams_mode(db, setting, None, user_id, api_key_id)
    except Exception:
        logger.warning("promptlog resolution failed", exc_info=True)
        return ResolvedSetting()
