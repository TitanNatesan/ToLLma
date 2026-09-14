"""Attachment endpoints only. No business logic, no engine imports."""

import uuid

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from tollms.core.deps import get_db
from tollms.core.security import get_current_user
from tollms.models.user import User
from tollms.api.attachments import service
from tollms.api.attachments.schemas import AttachmentRead, AttachmentUploadResponse
from tollms.services.gateway.attachments import storage_root

router = APIRouter(prefix="/api/v1/chat/attachments", tags=["attachments"])


@router.post("", response_model=AttachmentUploadResponse, status_code=201)
async def upload(
    file: UploadFile = File(...),
    conversation_id: uuid.UUID | None = Form(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AttachmentUploadResponse:
    data = await file.read()
    row = service.upload_attachment(
        db,
        user_id=user.id,
        filename=file.filename or "upload",
        content_type=file.content_type,
        data=data,
        conversation_id=conversation_id,
    )
    return AttachmentUploadResponse(
        attachment_id=row.id, filename=row.filename, mime_type=row.mime_type,
        kind=row.kind, size=row.file_size,
    )


@router.get("/{attachment_id}", response_model=AttachmentRead)
def get(attachment_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> AttachmentRead:
    return AttachmentRead.model_validate(service.get_attachment(db, attachment_id, user.id))


@router.get("/{attachment_id}/content")
def content(
    attachment_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> FileResponse:
    row, _ = service.read_content(db, attachment_id, user.id)
    return FileResponse(
        path=storage_root() / row.storage_path,
        media_type=row.mime_type,
        filename=row.filename,
    )


@router.delete("/{attachment_id}", status_code=204)
def delete(attachment_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> None:
    service.delete_attachment(db, attachment_id, user.id)
