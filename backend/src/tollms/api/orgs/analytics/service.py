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
        key_names = {
            k.id: k.name for k in db.execute(
                select(ApiKey).where(ApiKey.id.in_([r[0] for r in key_rows])))
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

    return AnalyticsOverview(
        totals=totals, by_day=by_day, by_model=by_model,
        by_provider=by_provider, by_user=by_user,
        by_team=by_team, by_key=by_key,
    )

