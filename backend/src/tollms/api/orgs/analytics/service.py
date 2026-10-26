"""Org usage ledger reads (aggregates only — never prompts or responses)."""

import uuid
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from tollms.api.orgs.common.guards import (
    _ORG_NOT_FOUND,
    _member_org,
    _parse_time,
    _live_membership,
    _parse_uuid,
    effective_permissions,
)
from tollms.api.orgs.schemas import (
    AnalyticsDayPoint,
    AnalyticsKeyRow,
    AnalyticsModelRow,
    AnalyticsOverview,
    AnalyticsProviderRow,
    AnalyticsTeamRow,
    AnalyticsTotals,
    AnalyticsUserRow,
    MemberAnalytics,
    MemberAnalyticsKeyRow,
    MemberAnalyticsTrendPoint,
)
from tollms.api.orgs.teams.service import _get_team
from tollms.core.exceptions import NotFoundError, ValidationError
from tollms.models.organization import Membership, TeamMembership
from tollms.models.user import User


def org_analytics_overview(db: Session, caller_id: uuid.UUID,
                           org_id: uuid.UUID, *, from_: str | None = None,
                           to_: str | None = None, team_id: str | None = None,
                           key_id: str | None = None) -> AnalyticsOverview:
    """Org usage overview. Gates: ACTIVE membership + Analytics.ViewUsage
    (strangers denied as 404). Cost fields are included only when the caller
    also holds Analytics.ViewCost, else null. ?from=/?to= bound created_at as
    ISO dates/datetimes (malformed is 422; absent = lifetime). ?team_id=
    scopes every section to users on that team's roster — a documented
    approximation (membership, not per-request team tagging); missing or
    foreign teams are 404. ?key_id= scopes to one org gateway key (foreign or
    missing keys are 404); malformed UUIDs are 422."""
    from tollms.models.api_key import ApiKey, ApiRequestLog
    from tollms.models.provider import Provider
    from tollms.models.registered_model import AIModel
    from tollms.models.request_log import RequestLog

    org, mem = _member_org(db, org_id, caller_id)
    perms = effective_permissions(db, org_id, caller_id)
    if "Analytics.ViewUsage" not in perms and not mem.is_root:
        raise NotFoundError(_ORG_NOT_FOUND)
    show_cost = bool(mem.is_root or "Analytics.ViewCost" in perms)

    from_dt = _parse_time(from_, "from")
    to_dt = _parse_time(to_, "to", end_of_day=True)
    roster: set[uuid.UUID] | None = None
    if team_id is not None:
        tid = _parse_uuid(team_id, "team_id")
        assert tid is not None
        _get_team(db, org_id, tid)
        roster = set(r[0] for r in db.execute(
            select(Membership.user_id)
            .join(TeamMembership, TeamMembership.membership_id == Membership.id)
            .where(TeamMembership.team_id == tid, Membership.is_deleted.is_(False))
        ).all())
    kid = _parse_uuid(key_id, "key_id")
    if kid is not None:
        key = db.get(ApiKey, kid)
        if key is None or key.org_id != org_id:
            raise NotFoundError("api key not found")

    extra_in = []
    extra_api = []
    if from_dt is not None:
        extra_in.append(RequestLog.created_at >= from_dt)
        extra_api.append(ApiRequestLog.created_at >= from_dt)
    if to_dt is not None:
        extra_in.append(RequestLog.created_at <= to_dt)
        extra_api.append(ApiRequestLog.created_at <= to_dt)
    if roster is not None:
        extra_in.append(RequestLog.user_id.in_(roster))
        extra_api.append(ApiRequestLog.user_id.in_(roster))
    if kid is not None:
        extra_in.append(RequestLog.api_key_id == kid)
        extra_api.append(ApiRequestLog.api_key_id == kid)
    in_base = [RequestLog.org_id == org_id, RequestLog.status == "success", *extra_in]
    api_base = [ApiRequestLog.org_id == org_id, ApiRequestLog.status == "success", *extra_api]

    def _money(value) -> Decimal | None:
        return Decimal(str(value or 0)) if show_cost else None

    in_app = db.execute(
        select(
            func.count(RequestLog.id),
            func.coalesce(func.sum(RequestLog.total_tokens), 0),
            func.coalesce(func.sum(RequestLog.total_cost), 0),
        ).where(*in_base)
    ).one()
    via_api = db.execute(
        select(
            func.count(ApiRequestLog.id),
            func.coalesce(func.sum(ApiRequestLog.total_tokens), 0),
            func.coalesce(func.sum(ApiRequestLog.cost), 0),
        ).where(*api_base)
    ).one()
    totals = AnalyticsTotals(
        requests=int(in_app[0] or 0) + int(via_api[0] or 0),
        tokens=int(in_app[1] or 0) + int(via_api[1] or 0),
        cost=_money(Decimal(str(in_app[2] or 0)) + Decimal(str(via_api[2] or 0))),
    )

    day_bucket_in = func.date_trunc("day", RequestLog.created_at)
    day_bucket_api = func.date_trunc("day", ApiRequestLog.created_at)
    day_rows_in = db.execute(
        select(
            day_bucket_in, func.count(RequestLog.id),
            func.coalesce(func.sum(RequestLog.total_tokens), 0),
            func.coalesce(func.sum(RequestLog.total_cost), 0),
        ).where(*in_base).group_by(day_bucket_in)
    ).all()
    day_rows_api = db.execute(
        select(
            day_bucket_api, func.count(ApiRequestLog.id),
            func.coalesce(func.sum(ApiRequestLog.total_tokens), 0),
            func.coalesce(func.sum(ApiRequestLog.cost), 0),
        ).where(*api_base).group_by(day_bucket_api)
    ).all()
    by_day_map: dict[str, dict] = {}
    for bucket, reqs, toks, cost in list(day_rows_in) + list(day_rows_api):
        day = bucket.date().isoformat() if hasattr(bucket, "date") else str(bucket)
        cell = by_day_map.setdefault(day, {"requests": 0, "tokens": 0, "cost": Decimal("0")})
        cell["requests"] += int(reqs or 0)
        cell["tokens"] += int(toks or 0)
        cell["cost"] += Decimal(str(cost or 0))
    by_day = [
        AnalyticsDayPoint(date=day, requests=cell["requests"], tokens=cell["tokens"],
                          cost=_money(cell["cost"]))
        for day, cell in sorted(by_day_map.items())
    ]

    model_rows_in = db.execute(
        select(
            AIModel.model_id, func.count(RequestLog.id),
            func.coalesce(func.sum(RequestLog.total_tokens), 0),
            func.coalesce(func.sum(RequestLog.total_cost), 0),
        ).join(AIModel, AIModel.id == RequestLog.model_id, isouter=True)
        .where(*in_base).group_by(AIModel.model_id)
    ).all()
    model_rows_api = db.execute(
        select(
            ApiRequestLog.model, func.count(ApiRequestLog.id),
            func.coalesce(func.sum(ApiRequestLog.total_tokens), 0),
            func.coalesce(func.sum(ApiRequestLog.cost), 0),
        ).where(*api_base).group_by(ApiRequestLog.model)
    ).all()
    by_model_map: dict[str, dict] = {}
    for label, reqs, toks, cost in list(model_rows_in) + list(model_rows_api):
        cell = by_model_map.setdefault(label or "unknown", {"requests": 0, "tokens": 0, "cost": Decimal("0")})
        cell["requests"] += int(reqs or 0)
        cell["tokens"] += int(toks or 0)
        cell["cost"] += Decimal(str(cost or 0))
    by_model = [
        AnalyticsModelRow(model=label, requests=cell["requests"], tokens=cell["tokens"],
                          cost=_money(cell["cost"]))
        for label, cell in sorted(by_model_map.items(), key=lambda kv: -kv[1]["requests"])
    ]

    prov_rows_in = db.execute(
        select(
            Provider.name, func.count(RequestLog.id),
            func.coalesce(func.sum(RequestLog.total_tokens), 0),
            func.coalesce(func.sum(RequestLog.total_cost), 0),
        ).join(Provider, Provider.id == RequestLog.provider_id, isouter=True)
        .where(*in_base).group_by(Provider.name)
    ).all()
    prov_rows_api = db.execute(
        select(
            ApiRequestLog.provider, func.count(ApiRequestLog.id),
            func.coalesce(func.sum(ApiRequestLog.total_tokens), 0),
            func.coalesce(func.sum(ApiRequestLog.cost), 0),
        ).where(*api_base).group_by(ApiRequestLog.provider)
    ).all()
    by_prov_map: dict[str, dict] = {}
    for label, reqs, toks, cost in list(prov_rows_in) + list(prov_rows_api):
        cell = by_prov_map.setdefault(label or "unknown", {"requests": 0, "tokens": 0, "cost": Decimal("0")})
        cell["requests"] += int(reqs or 0)
        cell["tokens"] += int(toks or 0)
        cell["cost"] += Decimal(str(cost or 0))
    by_provider = [
        AnalyticsProviderRow(provider=label, requests=cell["requests"], tokens=cell["tokens"],
                             cost=_money(cell["cost"]))
        for label, cell in sorted(by_prov_map.items(), key=lambda kv: -kv[1]["requests"])
    ]

    user_rows_in = db.execute(
        select(
            RequestLog.user_id, func.count(RequestLog.id),
            func.coalesce(func.sum(RequestLog.total_tokens), 0),
            func.coalesce(func.sum(RequestLog.total_cost), 0),
        ).where(*in_base).group_by(RequestLog.user_id)
    ).all()
    user_rows_api = db.execute(
        select(
            ApiRequestLog.user_id, func.count(ApiRequestLog.id),
            func.coalesce(func.sum(ApiRequestLog.total_tokens), 0),
            func.coalesce(func.sum(ApiRequestLog.cost), 0),
        ).where(*api_base).group_by(ApiRequestLog.user_id)
    ).all()
    by_user_map: dict[str | None, dict] = {}
    for uid, reqs, toks, cost in list(user_rows_in) + list(user_rows_api):
        cell = by_user_map.setdefault(str(uid) if uid else None, {"requests": 0, "tokens": 0, "cost": Decimal("0")})
        cell["requests"] += int(reqs or 0)
        cell["tokens"] += int(toks or 0)
        cell["cost"] += Decimal(str(cost or 0))
    by_user: list[AnalyticsUserRow] = []
    for uid_str, cell in sorted(by_user_map.items(), key=lambda kv: -kv[1]["requests"]):
        uid = uuid.UUID(uid_str) if uid_str else None
        user = db.get(User, uid) if uid else None
        live = (
            _live_membership(db, org_id, uid) is not None if uid is not None else False
        )
        by_user.append(AnalyticsUserRow(
            user_id=uid, email=user.email if user else None,
            removed_badge=bool(uid is not None and not live),
            requests=cell["requests"], tokens=cell["tokens"], cost=_money(cell["cost"]),
        ))

    # by_key: gateway traffic grouped by key (reliable attribution — every
    # gateway row carries its key). In-app request_logs rows are excluded
    # here even when they reference a key; key-less rows (NULL) are skipped.
    key_rows = db.execute(
        select(
            ApiRequestLog.api_key_id, func.count(ApiRequestLog.id),
            func.coalesce(func.sum(ApiRequestLog.total_tokens), 0),
            func.coalesce(func.sum(ApiRequestLog.cost), 0),
        ).where(*api_base, ApiRequestLog.api_key_id.is_not(None))
        .group_by(ApiRequestLog.api_key_id)
    ).all()
    key_names: dict[uuid.UUID, str] = {}
    if key_rows:
        # Live-only: revoked keys stay attributed but nameless.
        key_names = {
            k.id: k.name for k in db.execute(
                select(ApiKey).where(ApiKey.id.in_([r[0] for r in key_rows]),
                                     ApiKey.is_deleted.is_(False)))
            .scalars().all()
        }
    by_key = [
        AnalyticsKeyRow(key_id=kid_, key_name=key_names.get(kid_), requests=int(reqs or 0),
                        tokens=int(toks or 0), cost=_money(cost))
        for kid_, reqs, toks, cost in sorted(key_rows, key=lambda r: -(r[1] or 0))
    ]
    # by_team is intentionally empty: users belong to any number of teams, so
    # per-team splits would double-count shared usage. Team scoping is
    # available via ?team_id= (roster filter applied to every section above).
    by_team: list[AnalyticsTeamRow] = []

    # Reliability signals over the same window/filters but ALL statuses
    # (the sections above count successes only). Cache sums ride the same
    # success-filtered rows as `totals`; rates are None on empty windows.
    in_all = [RequestLog.org_id == org_id, *extra_in]
    api_all = [ApiRequestLog.org_id == org_id, *extra_api]
    rel_in = db.execute(select(
        func.count(RequestLog.id),
        func.count(RequestLog.id).filter(RequestLog.status == "success"),
        func.coalesce(func.sum(RequestLog.cache_read_tokens), 0),
        func.coalesce(func.sum(RequestLog.prompt_tokens), 0),
    ).where(*in_all)).one()
    rel_api = db.execute(select(
        func.count(ApiRequestLog.id),
        func.count(ApiRequestLog.id).filter(ApiRequestLog.status == "success"),
        func.coalesce(func.sum(ApiRequestLog.cache_read_tokens), 0),
        func.coalesce(func.sum(ApiRequestLog.input_tokens), 0),
    ).where(*api_all)).one()
    total_requests = int(rel_in[0] or 0) + int(rel_api[0] or 0)
    successful_requests = int(rel_in[1] or 0) + int(rel_api[1] or 0)
    cache_read = int(rel_in[2] or 0) + int(rel_api[2] or 0)
    input_tokens = int(rel_in[3] or 0) + int(rel_api[3] or 0)
    success_rate = (100.0 * successful_requests / total_requests) if total_requests else None
    cache_base = input_tokens + cache_read
    cache_hit_rate = (100.0 * cache_read / cache_base) if cache_base else None

    return AnalyticsOverview(
        totals=totals, by_day=by_day, by_model=by_model,
        by_provider=by_provider, by_user=by_user,
        by_team=by_team, by_key=by_key,
        successful_requests=successful_requests, total_requests=total_requests,
        success_rate=success_rate, cache_read_tokens=cache_read,
        input_tokens=input_tokens, cache_hit_rate=cache_hit_rate,
    )



def member_analytics(db: Session, caller_id: uuid.UUID, org_id: uuid.UUID,
                     member_id: uuid.UUID, *, from_: str | None = None,
                     to_: str | None = None) -> MemberAnalytics:
    """One member's org-scoped usage (Analytics.ViewUsage; cost needs ViewCost).

    Scope: request_logs (org_id + user_id = member, internal generations incl.
    keyed in-app runs) + api_request_logs (same filter, public gateway).
    Disjoint planes, summed without double-counting; personal traffic never
    matches the org_id filter. Target needs a membership row (active or
    not — revoked history retained); strangers are 404 oracles."""
    from tollms.models.api_key import ApiKey, ApiRequestLog
    from tollms.models.guardrail import GuardrailTrigger
    from tollms.models.provider import Provider
    from tollms.models.registered_model import AIModel
    from tollms.models.request_log import RequestLog

    org, mem = _member_org(db, org_id, caller_id)
    perms = effective_permissions(db, org_id, caller_id)
    if "Analytics.ViewUsage" not in perms and not mem.is_root:
        raise NotFoundError(_ORG_NOT_FOUND)
    show_cost = bool(mem.is_root or "Analytics.ViewCost" in perms)

    known = db.scalar(select(Membership.id).where(
        Membership.org_id == org_id, Membership.user_id == member_id))
    if known is None:
        raise NotFoundError(_ORG_NOT_FOUND)

    from_dt = _parse_time(from_, "from")
    to_dt = _parse_time(to_, "to", end_of_day=True)

    in_base = [RequestLog.org_id == org_id, RequestLog.user_id == member_id]
    api_base = [ApiRequestLog.org_id == org_id, ApiRequestLog.user_id == member_id]
    if from_dt is not None:
        in_base.append(RequestLog.created_at >= from_dt)
        api_base.append(ApiRequestLog.created_at >= from_dt)
    if to_dt is not None:
        in_base.append(RequestLog.created_at <= to_dt)
        api_base.append(ApiRequestLog.created_at <= to_dt)

    def _money(value) -> Decimal | None:
        return Decimal(str(value or 0)) if show_cost else None

    in_row = db.execute(select(
        func.count(RequestLog.id),
        func.count(RequestLog.id).filter(RequestLog.status == "success"),
        func.count(RequestLog.id).filter(RequestLog.status == "failed"),
        func.coalesce(func.sum(RequestLog.prompt_tokens), 0),
        func.coalesce(func.sum(RequestLog.completion_tokens), 0),
        func.coalesce(func.sum(RequestLog.total_tokens), 0),
        func.coalesce(func.sum(RequestLog.cache_read_tokens), 0),
        func.coalesce(func.sum(RequestLog.cache_write_tokens), 0),
        func.coalesce(func.sum(RequestLog.total_cost), 0),
        func.max(RequestLog.created_at),
    ).where(*in_base)).one()
    api_row = db.execute(select(
        func.count(ApiRequestLog.id),
        func.count(ApiRequestLog.id).filter(ApiRequestLog.status == "success"),
        func.count(ApiRequestLog.id).filter(ApiRequestLog.status == "failed"),
        func.coalesce(func.sum(ApiRequestLog.input_tokens), 0),
        func.coalesce(func.sum(ApiRequestLog.output_tokens), 0),
        func.coalesce(func.sum(ApiRequestLog.total_tokens), 0),
        func.coalesce(func.sum(ApiRequestLog.cache_read_tokens), 0),
        func.coalesce(func.sum(ApiRequestLog.cache_write_tokens), 0),
        func.coalesce(func.sum(ApiRequestLog.cost), 0),
        func.max(ApiRequestLog.created_at),
    ).where(*api_base)).one()

    requests = int(in_row[0] or 0) + int(api_row[0] or 0)
    succeeded = int(in_row[1] or 0) + int(api_row[1] or 0)
    failed = int(in_row[2] or 0) + int(api_row[2] or 0)
    input_tokens = int(in_row[3] or 0) + int(api_row[3] or 0)
    output_tokens = int(in_row[4] or 0) + int(api_row[4] or 0)
    total_tokens = int(in_row[5] or 0) + int(api_row[5] or 0)
    cache_read = int(in_row[6] or 0) + int(api_row[6] or 0)
    cache_write = int(in_row[7] or 0) + int(api_row[7] or 0)
    total = Decimal(str(in_row[8] or 0)) + Decimal(str(api_row[8] or 0))

    blocked_filters = [GuardrailTrigger.org_id == org_id,
                       GuardrailTrigger.user_id == member_id,
                       GuardrailTrigger.action == "blocked"]
    if from_dt is not None:
        blocked_filters.append(GuardrailTrigger.created_at >= from_dt)
    if to_dt is not None:
        blocked_filters.append(GuardrailTrigger.created_at <= to_dt)
    blocked = int(db.scalar(select(func.count(GuardrailTrigger.id)).where(
        *blocked_filters)) or 0)

    model_map: dict[str, dict] = {}
    for label, reqs, toks, cost in db.execute(
        select(AIModel.model_id, func.count(RequestLog.id),
               func.coalesce(func.sum(RequestLog.total_tokens), 0),
               func.coalesce(func.sum(RequestLog.total_cost), 0))
        .join(AIModel, AIModel.id == RequestLog.model_id, isouter=True)
        .where(*in_base).group_by(AIModel.model_id)
    ).all():
        cell = model_map.setdefault(label or "unknown", {"requests": 0, "tokens": 0, "cost": Decimal("0")})
        cell["requests"] += int(reqs or 0)
        cell["tokens"] += int(toks or 0)
        cell["cost"] += Decimal(str(cost or 0))
    for label, reqs, toks, cost in db.execute(
        select(ApiRequestLog.model, func.count(ApiRequestLog.id),
               func.coalesce(func.sum(ApiRequestLog.total_tokens), 0),
               func.coalesce(func.sum(ApiRequestLog.cost), 0))
        .where(*api_base).group_by(ApiRequestLog.model)
    ).all():
        cell = model_map.setdefault(label or "unknown", {"requests": 0, "tokens": 0, "cost": Decimal("0")})
        cell["requests"] += int(reqs or 0)
        cell["tokens"] += int(toks or 0)
        cell["cost"] += Decimal(str(cost or 0))
    by_model = [AnalyticsModelRow(model=label, requests=cell["requests"],
                                  tokens=cell["tokens"], cost=_money(cell["cost"]))
                for label, cell in sorted(model_map.items(), key=lambda kv: -kv[1]["requests"])]

    prov_map: dict[str, dict] = {}
    for label, reqs, toks, cost in db.execute(
        select(Provider.name, func.count(RequestLog.id),
               func.coalesce(func.sum(RequestLog.total_tokens), 0),
               func.coalesce(func.sum(RequestLog.total_cost), 0))
        .join(Provider, Provider.id == RequestLog.provider_id, isouter=True)
        .where(*in_base).group_by(Provider.name)
    ).all():
        cell = prov_map.setdefault(label or "unknown", {"requests": 0, "tokens": 0, "cost": Decimal("0")})
        cell["requests"] += int(reqs or 0)
        cell["tokens"] += int(toks or 0)
        cell["cost"] += Decimal(str(cost or 0))
    for label, reqs, toks, cost in db.execute(
        select(ApiRequestLog.provider, func.count(ApiRequestLog.id),
               func.coalesce(func.sum(ApiRequestLog.total_tokens), 0),
               func.coalesce(func.sum(ApiRequestLog.cost), 0))
        .where(*api_base).group_by(ApiRequestLog.provider)
    ).all():
        cell = prov_map.setdefault(label or "unknown", {"requests": 0, "tokens": 0, "cost": Decimal("0")})
        cell["requests"] += int(reqs or 0)
        cell["tokens"] += int(toks or 0)
        cell["cost"] += Decimal(str(cost or 0))
    by_provider = [AnalyticsProviderRow(provider=label, requests=cell["requests"],
                                        tokens=cell["tokens"], cost=_money(cell["cost"]))
                   for label, cell in sorted(prov_map.items(), key=lambda kv: -kv[1]["requests"])]

    # by_key: gateway rows (always keyed) + in-app rows that reference an
    # org-scoped key. Personal-key rows — even when attributed to the org —
    # are excluded to preserve personal vs org key isolation.
    key_map: dict[uuid.UUID, dict] = {}
    for kid, reqs, toks, cost in db.execute(
        select(ApiRequestLog.api_key_id, func.count(ApiRequestLog.id),
               func.coalesce(func.sum(ApiRequestLog.total_tokens), 0),
               func.coalesce(func.sum(ApiRequestLog.cost), 0))
        .where(*api_base, ApiRequestLog.api_key_id.is_not(None))
        .group_by(ApiRequestLog.api_key_id)
    ).all():
        cell = key_map.setdefault(kid, {"requests": 0, "tokens": 0, "cost": Decimal("0")})
        cell["requests"] += int(reqs or 0)
        cell["tokens"] += int(toks or 0)
        cell["cost"] += Decimal(str(cost or 0))
    for kid, reqs, toks, cost in db.execute(
        select(RequestLog.api_key_id, func.count(RequestLog.id),
               func.coalesce(func.sum(RequestLog.total_tokens), 0),
               func.coalesce(func.sum(RequestLog.total_cost), 0))
        .where(*in_base, RequestLog.api_key_id.is_not(None))
        .group_by(RequestLog.api_key_id)
    ).all():
        cell = key_map.setdefault(kid, {"requests": 0, "tokens": 0, "cost": Decimal("0")})
        cell["requests"] += int(reqs or 0)
        cell["tokens"] += int(toks or 0)
        cell["cost"] += Decimal(str(cost or 0))
    if key_map:
        # Org-keys only: drop any personal-key attribution (org_id NULL or
        # another org) before naming. Revoked org keys stay attributed.
        org_key_ids = set(db.scalars(
            select(ApiKey.id).where(ApiKey.id.in_(list(key_map)),
                                    ApiKey.org_id == org_id)).all())
        key_map = {kid: cell for kid, cell in key_map.items()
                   if kid in org_key_ids}
    key_names: dict[uuid.UUID, str] = {}
    if key_map:
        # Live-only: revoked keys stay attributed but nameless — never
        # crash, never leak deleted names.
        key_names = {k.id: k.name for k in db.execute(
            select(ApiKey).where(ApiKey.id.in_(list(key_map)),
                                 ApiKey.is_deleted.is_(False))).scalars().all()}
    by_key = [MemberAnalyticsKeyRow(key_id=kid, key_name=key_names.get(kid),
                                    requests=cell["requests"], tokens=cell["tokens"],
                                    cost=_money(cell["cost"]))
              for kid, cell in sorted(key_map.items(), key=lambda kv: -kv[1]["requests"])]

    trend_map: dict[str, dict] = {}
    day_in = func.date_trunc("day", RequestLog.created_at)
    day_api = func.date_trunc("day", ApiRequestLog.created_at)
    for bucket, reqs, toks, cost in list(db.execute(
        select(day_in, func.count(RequestLog.id),
               func.coalesce(func.sum(RequestLog.total_tokens), 0),
               func.coalesce(func.sum(RequestLog.total_cost), 0))
        .where(*in_base).group_by(day_in)).all()) + list(db.execute(
        select(day_api, func.count(ApiRequestLog.id),
               func.coalesce(func.sum(ApiRequestLog.total_tokens), 0),
               func.coalesce(func.sum(ApiRequestLog.cost), 0))
        .where(*api_base).group_by(day_api)).all()):
        day = bucket.date().isoformat() if hasattr(bucket, "date") else str(bucket)
        cell = trend_map.setdefault(day, {"requests": 0, "tokens": 0, "cost": Decimal("0")})
        cell["requests"] += int(reqs or 0)
        cell["tokens"] += int(toks or 0)
        cell["cost"] += Decimal(str(cost or 0))
    trend = [MemberAnalyticsTrendPoint(bucket=day, requests=cell["requests"],
                                      tokens=cell["tokens"], cost=_money(cell["cost"]))
             for day, cell in sorted(trend_map.items())]

    last_activity = max((v for v in (in_row[9], api_row[9]) if v is not None),
                        default=None)
    last_model: str | None = None
    last_key: str | None = None
    if last_activity is not None:
        latest_in = db.execute(
            select(RequestLog.created_at, AIModel.model_id, ApiKey.name)
            .join(AIModel, AIModel.id == RequestLog.model_id, isouter=True)
            .join(ApiKey, (ApiKey.id == RequestLog.api_key_id)
                  & (ApiKey.is_deleted.is_(False)), isouter=True)
            .where(*in_base).order_by(RequestLog.created_at.desc()).limit(1)).first()
        latest_api = db.execute(
            select(ApiRequestLog.created_at, ApiRequestLog.model, ApiKey.name)
            .join(ApiKey, (ApiKey.id == ApiRequestLog.api_key_id)
                  & (ApiKey.is_deleted.is_(False)), isouter=True)
            .where(*api_base).order_by(ApiRequestLog.created_at.desc()).limit(1)).first()
        pick = None
        for row in (latest_in, latest_api):
            if row is not None and (pick is None or row[0] > pick[0]):
                pick = row
        if pick is not None:
            last_model = pick[1]
            last_key = pick[2]

    return MemberAnalytics(
        user_id=member_id, requests=requests, succeeded=succeeded, failed=failed,
        blocked=blocked, input_tokens=input_tokens, output_tokens=output_tokens,
        total_tokens=total_tokens, cache_read_tokens=cache_read,
        cache_write_tokens=cache_write, total_cost=_money(total),
        avg_cost_per_request=(total / requests if show_cost and requests else None),
        by_model=by_model, by_provider=by_provider, by_key=by_key, trend=trend,
        last_activity=last_activity.isoformat() if last_activity is not None else None,
        last_model=last_model, last_key=last_key)
