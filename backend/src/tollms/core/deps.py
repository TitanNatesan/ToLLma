"""Shared FastAPI dependencies."""

from collections.abc import Iterator

from sqlalchemy.orm import Session

from tollms.db.session import SessionLocal


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
