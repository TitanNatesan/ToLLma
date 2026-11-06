"""Seed legal_documents from docs/legal/*.md (draft rows, never published).

Usage (repo root):  PYTHONPATH=backend/src python backend/scripts/seed_legal.py
Inside compose backend (docs not mounted): pass DOCS_DIR, e.g.
  docker compose run --rm -v ./docs:/docs:ro -e DOCS_DIR=/docs/legal backend python /app/scripts/seed_legal.py
Idempotent: re-running updates title/body/hash of existing slug+version rows.
Publishing stays a deliberate platform-admin API call.
"""

import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend" / "src"))

from sqlalchemy import select  # noqa: E402

from tollms.db.session import SessionLocal  # noqa: E402
from tollms.models.legal import LegalDocument, content_hash_for  # noqa: E402

DOCS_DIR = Path(os.environ.get("DOCS_DIR", str(ROOT / "docs" / "legal")))

HEADER_RE = re.compile(r"^- slug:\s*`([^`]+)`\s*·\s*version:\s*`([^`]+)`", re.M)
TITLE_RE = re.compile(r"^#\s+(.+?)(?:\s*\(DRAFT\))?\s*$", re.M)


def parse(path: Path) -> dict | None:
    text = path.read_text(encoding="utf-8")
    m = HEADER_RE.search(text)
    if not m:
        print(f"SKIP {path.name}: no slug header")
        return None
    slug, version = m.group(1), m.group(2)
    t = TITLE_RE.search(text)
    title = t.group(1).strip() if t else slug
    return {"slug": slug, "version": version, "title": title, "body": text}


def main() -> None:
    docs = sorted(DOCS_DIR.glob("*.md"))
    docs = [p for p in docs if p.name != "00-README.md"]
    db = SessionLocal()
    try:
        for path in docs:
            parsed = parse(path)
            if parsed is None:
                continue
            row = db.scalar(
                select(LegalDocument).where(
                    LegalDocument.slug == parsed["slug"],
                    LegalDocument.version == parsed["version"],
                    LegalDocument.is_deleted.is_(False),
                )
            )
            if row is None:
                row = LegalDocument(
                    slug=parsed["slug"], version=parsed["version"], title=parsed["title"],
                    locale="en-IN", status="draft", body=parsed["body"],
                    content_hash=content_hash_for(parsed["body"]),
                )
                db.add(row)
                print(f"INSERT {parsed['slug']}@{parsed['version']}")
            else:
                if row.status == "published":
                    print(f"SKIP {parsed['slug']}@{parsed['version']}: published (immutable)")
                    continue
                row.title = parsed["title"]
                row.body = parsed["body"]
                row.content_hash = content_hash_for(parsed["body"])
                print(f"UPDATE {parsed['slug']}@{parsed['version']}")
        db.commit()
    finally:
        db.close()


if __name__ == "__main__":
    main()
