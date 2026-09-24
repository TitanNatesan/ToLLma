"""Image/video generation analytics (platform-wide, aggregates only).

Counts and costs come from assistant messages whose ``metadata.generation_type``
is ``image`` or ``video``. Bytes come from image/video attachment rows (sizes
only — storage paths, filenames and extracted text are never read):
``media_bytes`` covers every stored image/video attachment in the window, while
``by_model`` sizes only cover attachments linked to a generated media message.

Engines return plain mappings (validated by the router's ``AdminMedia``
response model); this package never imports from ``tollms.api``.
"""

import logging
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from tollms.models.attachment import Attachment
from tollms.models.message import Message
from tollms.models.registered_model import AIModel
from tollms.services.admin import AdminWindow
from tollms.services.admin.usage import bucket_expr, scope_conditions, window_range

logger = logging.getLogger(__name__)

KINDS = ("image", "video")
_KIND_LABELS = {"image": "Images", "video": "Videos"}


def _kind_expr() -> Any:
    """JSONB ``metadata.generation_type`` as text (filter/comparison column)."""
    return Message.metadata_["generation_type"].astext


def _media_scope(window: AdminWindow) -> list[Any]:
    return scope_conditions(window) + [_kind_expr().in_(KINDS)]


def _attachment_scope(window: AdminWindow) -> list[Any]:
    return [
        Attachment.is_deleted.is_(False),
        Attachment.kind.in_(KINDS),
        Attachment.created_at >= window.start,
        Attachment.created_at < window.end,
    ]


def _point(bucket: Any) -> dict[str, Any]:
    return {"bucket": bucket, "images": 0, "videos": 0, "media_bytes": 0, "cost": Decimal(0)}


def _series(db: Session, window: AdminWindow) -> list[dict[str, Any]]:
    """Per-bucket media counts/cost (messages) merged with bytes (attachments)."""
    message_bucket = bucket_expr(db, window)
    attachment_bucket = bucket_expr(db, window, Attachment.created_at)
    kind_column = _kind_expr()
    points: dict[Any, dict[str, Any]] = {}
    for bucket, kind, count, cost in db.execute(
        select(
            message_bucket,
            kind_column,
            func.count(Message.id),
            func.coalesce(func.sum(Message.total_cost), 0),
        )
        .select_from(Message)
        .where(*_media_scope(window))
        .group_by(message_bucket, kind_column)
        .order_by(message_bucket)
    ).all():
        if bucket is None:
            continue
        point = points.setdefault(bucket, _point(bucket))
        if kind == "image":
            point["images"] += int(count or 0)
        else:
            point["videos"] += int(count or 0)
        point["cost"] += Decimal(str(cost or 0))
    for bucket, size in db.execute(
        select(attachment_bucket, func.coalesce(func.sum(Attachment.file_size), 0))
        .select_from(Attachment)
        .where(*_attachment_scope(window))
        .group_by(attachment_bucket)
        .order_by(attachment_bucket)
    ).all():
        if bucket is None:
            continue
        points.setdefault(bucket, _point(bucket))["media_bytes"] += int(size or 0)
    return [points[bucket] for bucket in sorted(points)]


def _by_model(db: Session, window: AdminWindow, limit: int) -> list[dict[str, Any]]:
    """Per (model, kind) counts/cost plus bytes via the owning message."""
    kind_column = _kind_expr()
    sizes = (
        select(
            Attachment.message_id.label("message_id"),
            func.sum(Attachment.file_size).label("bytes"),
        )
        .where(
            Attachment.message_id.is_not(None),
            Attachment.is_deleted.is_(False),
            Attachment.kind.in_(KINDS),
        )
        .group_by(Attachment.message_id)
        .subquery()
    )
    rows = db.execute(
        select(
            Message.model_id,
            AIModel.name,
            kind_column,
            func.count(Message.id),
            func.coalesce(func.sum(Message.total_cost), 0),
            func.coalesce(func.sum(sizes.c.bytes), 0),
        )
        .select_from(Message)
        .outerjoin(sizes, sizes.c.message_id == Message.id)
        .outerjoin(AIModel, AIModel.id == Message.model_id)
        .where(*_media_scope(window))
        .group_by(Message.model_id, AIModel.name, kind_column)
        .order_by(func.coalesce(func.sum(Message.total_cost), 0).desc())
        .limit(limit)
    ).all()
    return [
        {
            "model_id": row[0],
            "model_name": row[1] or "Unknown",
            "kind": row[2],
            "count": int(row[3] or 0),
            "media_bytes": int(row[5] or 0),
            "cost": Decimal(str(row[4] or 0)),
        }
        for row in rows
    ]


def _by_kind(
    totals: dict[str, dict[str, Any]], bytes_by_kind: dict[str, int]
) -> list[dict[str, Any]]:
    rows = []
    for kind in KINDS:
        count = totals[kind]["count"]
        size = bytes_by_kind[kind]
        cost = totals[kind]["cost"]
        if not (count or size or cost):
            continue
        rows.append(
            {
                "model_id": None,
                "model_name": _KIND_LABELS[kind],
                "kind": kind,
                "count": count,
                "media_bytes": size,
                "cost": cost,
            }
        )
    return rows


def media(db: Session, window: AdminWindow, *, limit: int = 10) -> dict[str, Any]:
    """Media totals, trend and top model/kind rows (matches ``AdminMedia``)."""
    totals = {kind: {"count": 0, "cost": Decimal(0)} for kind in KINDS}
    kind_column = _kind_expr()
    for kind, count, cost in db.execute(
        select(kind_column, func.count(Message.id), func.coalesce(func.sum(Message.total_cost), 0))
        .select_from(Message)
        .where(*_media_scope(window))
        .group_by(kind_column)
    ).all():
        if kind in totals:
            totals[kind] = {"count": int(count or 0), "cost": Decimal(str(cost or 0))}
    bytes_by_kind = {kind: 0 for kind in KINDS}
    for kind, size in db.execute(
        select(Attachment.kind, func.coalesce(func.sum(Attachment.file_size), 0))
        .select_from(Attachment)
        .where(*_attachment_scope(window))
        .group_by(Attachment.kind)
    ).all():
        if kind in bytes_by_kind:
            bytes_by_kind[kind] = int(size or 0)
    return {
        "range": window_range(window),
        "images": totals["image"]["count"],
        "videos": totals["video"]["count"],
        "media_bytes": bytes_by_kind["image"] + bytes_by_kind["video"],
        "image_cost": totals["image"]["cost"],
        "video_cost": totals["video"]["cost"],
        "series": _series(db, window),
        "by_model": _by_model(db, window, limit),
        "by_kind": _by_kind(totals, bytes_by_kind),
    }
