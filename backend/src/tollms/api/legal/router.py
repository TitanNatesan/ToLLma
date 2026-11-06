"""Legal endpoints. Reads are public; writes are platform-admin; acceptance is authed."""

from fastapi import APIRouter, Depends, Query, Request

from tollms.api.legal import schemas, service
from tollms.core.dependencies import get_current_user, require_active_user
from tollms.core.deps import get_db
from tollms.core.security import platform_admin_required
from tollms.models.user import User
from sqlalchemy.orm import Session

router = APIRouter(prefix="/api/v1/legal", tags=["legal"])


@router.get("/documents", response_model=list[schemas.LegalDocumentRead])
def list_documents(locale: str = Query(default="en-IN", max_length=12),
                   db: Session = Depends(get_db)) -> list:
    return service.list_published(db, locale=locale)


@router.get("/documents/{slug}", response_model=schemas.LegalDocumentBody)
def get_document(slug: str, version: str | None = Query(default=None, max_length=32),
                 db: Session = Depends(get_db)) -> dict:
    return service.get_document(db, slug, version=version)


@router.post("/documents", response_model=schemas.LegalDocumentRead)
def upsert_document(data: schemas.LegalDocumentUpsert, db: Session = Depends(get_db),
                    _: User = Depends(platform_admin_required)) -> dict:
    return service.upsert_document(
        db, slug=data.slug, version=data.version, title=data.title, locale=data.locale,
        body=data.body, requires_reaccept=data.requires_reaccept,
        effective_at=data.effective_at, publish=data.publish,
    )


@router.post("/acceptances", response_model=schemas.LegalAcceptanceRead)
def accept_document(data: schemas.LegalAcceptanceCreate, request: Request,
                    db: Session = Depends(get_db),
                    user: User = Depends(require_active_user)) -> dict:
    ip = request.headers.get("x-forwarded-for", "").split(",")[0].strip()[:64] or None
    return service.accept_current(
        db, user, slug=data.slug, method="api_explicit", ui_version=data.ui_version,
        ip=ip, user_agent=request.headers.get("user-agent"),
    )


@router.get("/acceptances/me", response_model=list[schemas.LegalAcceptanceRead])
def my_acceptances(db: Session = Depends(get_db),
                   user: User = Depends(get_current_user)) -> list:
    return service.acceptance_history(db, user)


@router.get("/reaccept-required", response_model=list[schemas.LegalDocumentRead])
def reaccept_required(db: Session = Depends(get_db),
                      user: User = Depends(get_current_user)) -> list:
    return service.needs_reaccept(db, user)
