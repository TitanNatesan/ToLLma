"""Legal registry service. CRUD + hash pinning + append-only acceptance."""

import hashlib
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from tollms.core.exceptions import ConflictError, NotFoundError, ValidationError
from tollms.models.legal import LegalAcceptance, LegalDocument, content_hash_for
from tollms.models.user import User

logger = logging.getLogger(__name__)

ACCEPT_METHODS = {"signup_checkbox", "reaccept_banner", "api_explicit", "google_signup_checkbox"}


def _read(doc: LegalDocument, *, with_body: bool = False) -> dict:
    base = {
        "slug": doc.slug,
        "version": doc.version,
        "title": doc.title,
        "locale": doc.locale,
        "status": doc.status,
        "content_hash": doc.content_hash,
        "requires_reaccept": doc.requires_reaccept,
        "effective_at": doc.effective_at,
        "published_at": doc.published_at,
    }
    if with_body:
        base["body"] = doc.body
    return base


def list_published(db: Session, *, locale: str = "en-IN") -> list[dict]:
    rows = (
        db.scalars(
            select(LegalDocument)
            .where(
                LegalDocument.status == "published",
                LegalDocument.locale == locale,
                LegalDocument.is_deleted.is_(False),
            )
            .order_by(LegalDocument.slug)
        )
        .all()
    )
    return [_read(r) for r in rows]


def get_document(db: Session, slug: str, *, version: str | None = None) -> dict:
    q = select(LegalDocument).where(
        LegalDocument.slug == slug, LegalDocument.is_deleted.is_(False)
    )
    if version is not None:
        row = db.scalar(q.where(LegalDocument.version == version))
    else:
        row = db.scalar(
            q.where(LegalDocument.status == "published").order_by(LegalDocument.version.desc())
        )
    if row is None:
        raise NotFoundError("legal document not found")
    return _read(row, with_body=True)


def upsert_document(db: Session, *, slug: str, version: str, title: str, locale: str,
                    body: str, requires_reaccept: bool, effective_at: datetime | None,
                    publish: bool) -> dict:
    existing = db.scalar(
        select(LegalDocument).where(
            LegalDocument.slug == slug,
            LegalDocument.version == version,
            LegalDocument.is_deleted.is_(False),
        )
    )
    if existing is not None and existing.status == "published":
        raise ConflictError("published versions are immutable — bump the version")
    content_hash = content_hash_for(body)
    if existing is None:
        doc = LegalDocument(
            slug=slug, version=version, title=title, locale=locale, body=body,
            content_hash=content_hash, requires_reaccept=requires_reaccept,
            effective_at=effective_at,
        )
        db.add(doc)
    else:
        doc = existing
        doc.title = title
        doc.body = body
        doc.content_hash = content_hash
        doc.requires_reaccept = requires_reaccept
        doc.effective_at = effective_at
    if publish:
        _publish(db, doc)
    db.commit()
    db.refresh(doc)
    logger.info("legal document upserted: %s@%s status=%s", slug, version, doc.status)
    return _read(doc)


def _publish(db: Session, doc: LegalDocument) -> None:
    now = datetime.now(timezone.utc)
    old = db.scalars(
        select(LegalDocument).where(
            LegalDocument.slug == doc.slug,
            LegalDocument.locale == doc.locale,
            LegalDocument.status == "published",
            LegalDocument.is_deleted.is_(False),
            LegalDocument.id != doc.id,
        )
    ).all()
    for row in old:
        row.status = "archived"
    doc.status = "published"
    doc.published_at = now
    if doc.effective_at is None:
        doc.effective_at = now


def _truncate_ip(ip: str | None) -> str | None:
    if not ip:
        return None
    try:
        digest = hashlib.sha256(f"legal-ip-salt:{ip}".encode()).hexdigest()[:16]
    except Exception:
        return None
    return f"hash:{digest}"


def accept_current(db: Session, user: User, *, slug: str, method: str,
                   ui_version: str | None, ip: str | None, user_agent: str | None) -> dict:
    if method not in ACCEPT_METHODS:
        raise ValidationError("unknown acceptance method")
    doc = db.scalar(
        select(LegalDocument).where(
            LegalDocument.slug == slug,
            LegalDocument.status == "published",
            LegalDocument.is_deleted.is_(False),
        )
    )
    if doc is None:
        raise NotFoundError("no published version to accept")
    dupe = db.scalar(
        select(LegalAcceptance).where(
            LegalAcceptance.user_id == user.id,
            LegalAcceptance.document_slug == slug,
            LegalAcceptance.content_hash == doc.content_hash,
        )
    )
    if dupe is not None:
        return _acceptance_read(dupe)
    row = LegalAcceptance(
        user_id=user.id,
        document_slug=slug,
        document_version=doc.version,
        content_hash=doc.content_hash,
        method=method,
        locale=doc.locale,
        ui_version=ui_version,
        ip_trunc=_truncate_ip(ip),
        user_agent_snippet=(user_agent or "")[:200] or None,
    )
    db.add(row)
    try:
        db.commit()
    except Exception:
        db.rollback()
        dupe = db.scalar(
            select(LegalAcceptance).where(
                LegalAcceptance.user_id == user.id,
                LegalAcceptance.document_slug == slug,
                LegalAcceptance.content_hash == doc.content_hash,
            )
        )
        if dupe is not None:
            return _acceptance_read(dupe)
        raise
    db.refresh(row)
    try:
        from tollms.api.security import service as security_service

        security_service.record_event(
            db, event_type="config.security_changed", outcome="allowed",
            actor_user_id=user.id, target_type="legal_document", target_id=doc.id,
            reason=f"legal.accepted:{slug}@{doc.version}",
        )
    except Exception:
        logger.warning("legal acceptance audit write failed", exc_info=True)
    return _acceptance_read(row)


def _acceptance_read(row: LegalAcceptance) -> dict:
    return {
        "id": row.id,
        "document_slug": row.document_slug,
        "document_version": row.document_version,
        "content_hash": row.content_hash,
        "accepted_at": row.accepted_at,
        "method": row.method,
        "locale": row.locale,
    }


def acceptance_history(db: Session, user: User) -> list[dict]:
    rows = (
        db.scalars(
            select(LegalAcceptance)
            .where(LegalAcceptance.user_id == user.id)
            .order_by(LegalAcceptance.accepted_at.desc())
        )
        .all()
    )
    return [_acceptance_read(r) for r in rows]


def needs_reaccept(db: Session, user: User) -> list[dict]:
    """Published docs with requires_reaccept whose current hash the user never accepted."""
    docs = db.scalars(
        select(LegalDocument).where(
            LegalDocument.status == "published",
            LegalDocument.requires_reaccept.is_(True),
            LegalDocument.is_deleted.is_(False),
        )
    ).all()
    accepted_hashes = set(
        db.scalars(
            select(LegalAcceptance.content_hash).where(LegalAcceptance.user_id == user.id)
        ).all()
    )
    return [_read(d) for d in docs if d.content_hash not in accepted_hashes]


def stamp_signup_acceptance(db: Session, user: User, *, method: str) -> None:
    """Best-effort: record acceptance of all published docs at signup."""
    docs = db.scalars(
        select(LegalDocument).where(
            LegalDocument.status == "published", LegalDocument.is_deleted.is_(False)
        )
    ).all()
    for doc in docs:
        dupe = db.scalar(
            select(LegalAcceptance).where(
                LegalAcceptance.user_id == user.id,
                LegalAcceptance.document_slug == doc.slug,
                LegalAcceptance.content_hash == doc.content_hash,
            )
        )
        if dupe is None:
            db.add(
                LegalAcceptance(
                    user_id=user.id,
                    document_slug=doc.slug,
                    document_version=doc.version,
                    content_hash=doc.content_hash,
                    method=method,
                    locale=doc.locale,
                )
            )
    try:
        db.commit()
    except Exception:
        db.rollback()
        logger.warning("signup legal acceptance stamp failed", exc_info=True)
