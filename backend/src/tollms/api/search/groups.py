"""Cross-type workspace search: members, teams, providers, guardrails, keys,
permission sets, prompt logs, audit events.

Metadata only — never credential values, raw keys, prompt bodies, or
secrets. Every type is workspace-scoped and permission-filtered; types the
caller may not see come back as empty groups (never 404 oracles per type).
"""

import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from tollms.api.orgs.common.audit_registry import format_event
from tollms.api.orgs.common.guards import _member_org, effective_permissions
from tollms.api.search.schemas import SearchGroupItem
from tollms.models.api_key import ApiKey
from tollms.models.guardrail import GuardrailPolicy
from tollms.models.organization import (
    AuditLog,
    Membership,
    MembershipState,
    PermissionSet,
    Team,
)
from tollms.models.prompt_logging import PromptLog
from tollms.models.provider import Provider
from tollms.models.user import User

SEARCHABLE_TYPES = (
    "members",
    "teams",
    "providers",
    "guardrails",
    "keys",
    "sets",
    "prompt_logs",
    "audit",
)


def parse_types(raw: str | None) -> list[str]:
    """Comma-separated ?types=. Unknown tokens are ignored (documented)."""
    if not raw:
        return []
    wanted = {t.strip().lower() for t in raw.split(",") if t.strip()}
    return [t for t in SEARCHABLE_TYPES if t in wanted]


def _like(value: str) -> str:
    """Escape LIKE wildcards so search text matches literally (Postgres
    backslash escape; same pattern as guards._escape_like)."""
    text = value.strip().lower()[:128]
    escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _allowed(perms: set[str], mem, code: str) -> bool:
    return bool(mem.is_root or code in perms)


def search_groups(db: Session, caller_id: uuid.UUID, query: str, *,
                  org_id: uuid.UUID | None, types: list[str],
                  per_type: int) -> dict[str, list[SearchGroupItem]]:
    """One capped LIKE query per requested type. No FTS, no secrets."""
    out: dict[str, list[SearchGroupItem]] = {}
    if not types or not query.strip():
        return out
    if org_id is None:
        return _personal_groups(db, caller_id, query, types, per_type)
    org, mem = _member_org(db, org_id, caller_id)
    perms = effective_permissions(db, org.id, caller_id)
    like = _like(query)
    if "members" in types:
        out["members"] = _org_members(db, org.id, like, per_type) \
            if _allowed(perms, mem, "Members.Read") else []
    if "teams" in types:
        out["teams"] = [
            SearchGroupItem(id=t.id, type="team", title=t.name,
                            subtitle=t.description,
                            created_at=t.created_at)
            for t in db.scalars(select(Team).where(
                Team.org_id == org.id, Team.is_deleted.is_(False),
                func.lower(Team.name).like(like, escape="\\"))
                .order_by(Team.name).limit(per_type)).all()
        ] if _allowed(perms, mem, "Teams.Read") else []
    if "providers" in types:
        out["providers"] = _providers(
            db, like, per_type,
            Provider.org_id == org.id) \
            if _allowed(perms, mem, "Providers.Read") else []
    if "guardrails" in types:
        out["guardrails"] = _policies(
            db, like, per_type, org_id=org.id) \
            if _allowed(perms, mem, "Guardrails.Read") else []
    if "keys" in types:
        out["keys"] = _keys(db, like, per_type, ApiKey.org_id == org.id) \
            if _allowed(perms, mem, "Keys.Read") else []
    if "sets" in types:
        out["sets"] = [
            SearchGroupItem(id=r.id, type="permission_set", title=r.name,
                            subtitle=r.description, created_at=r.created_at)
            for r in db.scalars(select(PermissionSet).where(
                or_(PermissionSet.org_id == org.id,
                    PermissionSet.org_id.is_(None)),
                PermissionSet.is_deleted.is_(False),
                func.lower(PermissionSet.name).like(like, escape="\\"))
                .order_by(PermissionSet.name).limit(per_type)).all()
        ] if _allowed(perms, mem, "PermissionSets.Read") else []
    if "prompt_logs" in types:
        out["prompt_logs"] = [
            SearchGroupItem(id=r.id, type="prompt_log",
                            title=r.request_id or str(r.id),
                            subtitle=f"{r.endpoint or ''} · {r.status}".strip(" ·"),
                            created_at=r.created_at)
            for r in db.scalars(select(PromptLog).where(
                PromptLog.org_id == org.id,
                or_(func.lower(PromptLog.request_id).like(like, escape="\\"),
                    func.lower(PromptLog.endpoint).like(like, escape="\\")))
                .order_by(PromptLog.created_at.desc()).limit(per_type)).all()
        ] if _allowed(perms, mem, "PromptLogs.Read") else []
    if "audit" in types:
        out["audit"] = [
            SearchGroupItem(id=r.id, type="audit_event",
                            title=format_event(r.action), snippet=r.action,
                            created_at=r.created_at)
            for r in db.scalars(select(AuditLog).where(
                AuditLog.org_id == org.id,
                func.lower(AuditLog.action).like(like, escape="\\"))
                .order_by(AuditLog.created_at.desc()).limit(per_type)).all()
        ] if _allowed(perms, mem, "Audit.Read") else []
    return out


def _personal_groups(db: Session, caller_id: uuid.UUID, query: str,
                     types: list[str], per_type: int) -> dict[str, list[SearchGroupItem]]:
    """Personal workspace: own providers/keys/guardrails only. Org-only
    types (members, teams, sets, prompt logs, audit) are empty here."""
    out: dict[str, list[SearchGroupItem]] = {}
    like = _like(query)
    if "providers" in types:
        out["providers"] = _providers(
            db, like, per_type,
            Provider.org_id.is_(None), Provider.user_id == caller_id)
    if "guardrails" in types:
        out["guardrails"] = _policies(db, like, per_type, user_id=caller_id)
    if "keys" in types:
        out["keys"] = _keys(db, like, per_type,
                             ApiKey.org_id.is_(None),
                             ApiKey.user_id == caller_id)
    for t in types:
        out.setdefault(t, [])
    return out


def _org_members(db: Session, org_id: uuid.UUID, like: str,
                 per_type: int) -> list[SearchGroupItem]:
    rows = db.execute(
        select(Membership, User)
        .join(User, User.id == Membership.user_id)
        .where(Membership.org_id == org_id, Membership.is_deleted.is_(False),
               Membership.state == MembershipState.ACTIVE.value,
               or_(func.lower(User.email).like(like, escape="\\"),
                   func.lower(User.full_name).like(like, escape="\\")))
        .order_by(User.email).limit(per_type)).all()
    return [SearchGroupItem(id=m.user_id, type="member", title=u.email,
                            subtitle=u.full_name,
                            created_at=m.created_at)
            for m, u in rows]


def _providers(db: Session, like: str, per_type: int, *scope) -> list[SearchGroupItem]:
    return [
        SearchGroupItem(id=p.id, type="provider", title=p.name,
                        subtitle=p.provider_type, created_at=p.created_at)
        for p in db.scalars(select(Provider).where(
            *scope, Provider.is_deleted.is_(False),
            func.lower(Provider.name).like(like, escape="\\"))
            .order_by(Provider.name).limit(per_type)).all()
    ]


def _policies(db: Session, like: str, per_type: int, *,
              org_id: uuid.UUID | None = None,
              user_id: uuid.UUID | None = None) -> list[SearchGroupItem]:
    stmt = select(GuardrailPolicy).where(
        GuardrailPolicy.is_deleted.is_(False),
        GuardrailPolicy.is_template.is_(False),
        func.lower(GuardrailPolicy.name).like(like, escape="\\"))
    if org_id is not None:
        stmt = stmt.where(GuardrailPolicy.org_id == org_id)
    else:
        stmt = stmt.where(GuardrailPolicy.org_id.is_(None),
                          GuardrailPolicy.user_id == user_id)
    return [
        SearchGroupItem(id=p.id, type="guardrail", title=p.name,
                        subtitle=f"{p.severity} · {p.enforcement}",
                        created_at=p.created_at)
        for p in db.scalars(stmt.order_by(GuardrailPolicy.name)
                            .limit(per_type)).all()
    ]


def _keys(db: Session, like: str, per_type: int, *scope) -> list[SearchGroupItem]:
    return [
        SearchGroupItem(id=k.id, type="api_key", title=k.name,
                        subtitle=k.key_prefix, created_at=k.created_at)
        for k in db.scalars(select(ApiKey).where(
            *scope, ApiKey.is_deleted.is_(False),
            func.lower(ApiKey.name).like(like, escape="\\"))
            .order_by(ApiKey.name).limit(per_type)).all()
    ]
