"""Export endpoints: conversations (MD/JSON/PDF) + analytics (CSV/XLSX/JSON)."""

import uuid

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from tollms.api.analytics import service as analytics_service
from tollms.api.exports import service
from tollms.api.exports.schemas import ConversationExportRequest, ExportEventRead
from tollms.core.deps import get_db
from tollms.core.security import get_current_user
from tollms.models.user import User

router = APIRouter(prefix="/api/v1/exports", tags=["exports"])


@router.post("/conversations")
def export_conversations(
    data: ConversationExportRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    content, media_type, filename, _ = service.render_conversations(
        db, user.id, data.conversation_ids, data.all, data.format
    )
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/conversations/{conversation_id}")
def export_conversation(
    conversation_id: uuid.UUID,
    format: str = Query(default="md", pattern="^(md|json|pdf)$"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    content, media_type, filename, _ = service.render_conversations(
        db, user.id, [conversation_id], False, format
    )
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/analytics")
def export_analytics(
    dataset: str = Query(default="summary", pattern="^(summary|models|providers|conversations|timeseries)$"),
    format: str = Query(default="csv", pattern="^(csv|xlsx|json)$"),
    range: str = Query(default="last_30d"),
    start: str | None = None,
    end: str | None = None,
    tz: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    content, media_type, filename = analytics_service.render_export(
        db, user, dataset=dataset, export_format=format, range_key=range, start=start, end=end, tz=tz
    )
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/history", response_model=list[ExportEventRead])
def history(
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[ExportEventRead]:
    return service.export_history(db, user.id, limit)
