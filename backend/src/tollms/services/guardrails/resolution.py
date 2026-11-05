"""Policy resolution: which guardrails apply to one call.

Workspace-global + provider/model + key scope. Org mandatory-wins: a block
from any applicable blocking policy cannot be overridden by a later allow —
the deciding policy is the highest-severity blocking one.
"""

import logging
import uuid
from dataclasses import dataclass, field

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session, selectinload

from tollms.models.guardrail import GuardrailAssignment, GuardrailPolicy

logger = logging.getLogger(__name__)

_SEVERITY_RANK = {"low": 0, "medium": 1, "high": 2, "critical": 3}


@dataclass
class Resolved:
    applied: list[GuardrailPolicy] = field(default_factory=list)
    deciding: GuardrailPolicy | None = None


def _active_org_ids(db: Session, user_id: uuid.UUID) -> set[uuid.UUID]:
    from tollms.models.organization import Membership, MembershipState

    try:
        return set(
            db.scalars(
                select(Membership.org_id).where(
                    Membership.user_id == user_id,
                    Membership.is_deleted.is_(False),
                    Membership.state == MembershipState.ACTIVE.value,
                )
            )
        )
    except Exception:
        logger.warning("guardrail org lookup failed", exc_info=True)
        return set()


def workspace_global_enforced(
    db: Session, *, user_id: uuid.UUID, org_id: uuid.UUID | None = None
) -> bool:
    """True when the workspace carries an enabled global-coverage policy.

    Rule A: an enabled, live, non-template policy in this workspace with
    zero live assignments (workspace-global) or any live global-scope
    assignment enforces every call. Rule B: without one, key-scoped
    policies apply only to their own key.

    Personal scope is `org_id=None` (the caller's own rows); otherwise the
    org must be one of the caller's ACTIVE orgs. DB errors log and return
    False — callers decide fail-open vs fail-closed.
    """
    try:
        if org_id is not None and org_id not in _active_org_ids(db, user_id):
            return False
        stmt = select(GuardrailPolicy).where(
            GuardrailPolicy.is_deleted.is_(False),
            GuardrailPolicy.is_enabled.is_(True),
            GuardrailPolicy.is_template.is_(False),
        )
        if org_id is None:
            stmt = stmt.where(GuardrailPolicy.org_id.is_(None),
                              GuardrailPolicy.user_id == user_id)
        else:
            stmt = stmt.where(GuardrailPolicy.org_id == org_id)
        stmt = stmt.options(selectinload(GuardrailPolicy.assignments))
        for policy in db.scalars(stmt):
            live = [a for a in (policy.assignments or []) if not a.is_deleted]
            if not live or any((a.scope_type or "global").lower() == "global"
                               for a in live):
                return True
        return False
    except Exception:
        logger.warning("guardrail global-enforced lookup failed", exc_info=True)
        return False


def resolve_key_guardrail_state(
    *, global_enabled: bool, key_assigned: bool
) -> tuple[bool, bool]:
    """Collapse workspace + key scope into (effective, locked).

    Rule A (global wins): workspace-global coverage enforces every call —
    effective regardless of key detachment, and the key UI must render it
    locked. Rule B (key independent): with no global coverage the key's
    own assignments decide, unlocked.
    """
    return (True if global_enabled else key_assigned, global_enabled)


def _applies(assignment: GuardrailAssignment, *, provider_id, model_id, api_key_id, source: str) -> bool:
    if source == "internal" and not assignment.applies_internal:
        return False
    if source == "external" and not assignment.applies_external:
        return False
    scope = (assignment.scope_type or "global").lower()
    if scope == "global":
        return True
    if scope == "provider":
        if assignment.provider_id is not None and assignment.provider_id != provider_id:
            return False
        if assignment.model_id is not None and assignment.model_id != model_id:
            return False
        return True
    if scope == "key":
        return assignment.api_key_id is not None and assignment.api_key_id == api_key_id
    return False


def resolve_applicable(
    db: Session,
    *,
    user_id: uuid.UUID | None,
    org_id: uuid.UUID | None = None,
    provider_id: uuid.UUID | None = None,
    model_id: uuid.UUID | None = None,
    api_key_id: uuid.UUID | None = None,
    source: str = "internal",
) -> Resolved:
    """Enabled, live policies in scope for one call.

    Personal rows belong to `user_id`; org rows belong to the caller's ACTIVE
    orgs (or the single verified `org_id`). Unscoped callers (user_id None)
    resolve nothing — the legacy keyless path has no workspace. Templates
    never auto-apply.

    Org-global policies always apply by scope (no detach possible): a policy
    with no assignments covers every call in its workspace. Visibility is
    filtered in SQL (no full-table pull) and assignments/rules/evaluators are
    eager-loaded (no per-policy N+1); the Python loop below re-checks scope
    as defense in depth.
    """
    if user_id is None:
        return Resolved()
    try:
        orgs = _active_org_ids(db, user_id)
        if org_id is not None:
            if org_id not in orgs:
                return Resolved()
            orgs = {org_id}
        personal = and_(GuardrailPolicy.org_id.is_(None),
                        GuardrailPolicy.user_id == user_id)
        stmt = select(GuardrailPolicy).where(
            GuardrailPolicy.is_deleted.is_(False),
            GuardrailPolicy.is_enabled.is_(True),
            GuardrailPolicy.is_template.is_(False),
        )
        if orgs:
            stmt = stmt.where(or_(personal, GuardrailPolicy.org_id.in_(list(orgs))))
        else:
            stmt = stmt.where(personal)
        stmt = stmt.options(
            selectinload(GuardrailPolicy.assignments),
            selectinload(GuardrailPolicy.rules),
            selectinload(GuardrailPolicy.evaluators),
        )
        candidates = list(db.scalars(stmt))
    except Exception:
        logger.warning("guardrail resolution query failed", exc_info=True)
        return Resolved()
    out: list[GuardrailPolicy] = []
    for policy in candidates:
        try:
            if policy.org_id is None:
                if policy.user_id != user_id:
                    continue
            elif policy.org_id not in orgs:
                continue
            live = [a for a in (policy.assignments or []) if not a.is_deleted]
            if not live:
                out.append(policy)  # no assignments = workspace-global
            elif any(_applies(a, provider_id=provider_id, model_id=model_id,
                              api_key_id=api_key_id, source=source) for a in live):
                out.append(policy)
        except Exception:
            logger.warning("guardrail policy %s skipped", getattr(policy, "id", "?"), exc_info=True)
    blocking = [p for p in out if (p.enforcement or "warn") == "block"]
    deciding: GuardrailPolicy | None = None
    if blocking:
        # Org mandatory-wins: the highest-severity blocking policy decides and
        # no allow from another policy can override it (enforced in check_pre
        # by evaluating blocks before anything else).
        deciding = max(blocking, key=lambda p: _SEVERITY_RANK.get(p.severity or "medium", 1))
    return Resolved(applied=out, deciding=deciding)
