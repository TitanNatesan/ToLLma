"""Privacy audit for `/api/admin/*`, encoded as tests.

Three independent layers:

1. Static scan of every admin service/API module for banned attribute
   accesses, identifiers and SQL fragments. Docstrings and comments are
   masked first so the modules' own privacy documentation is not a
   false positive.
2. Runtime scan: seed marker message content, a conversation title and a
   provider credential, call every endpoint as a platform admin and assert
   the raw JSON text never contains any marker.
3. Structural scan: no response, at any nesting depth, carries content-shaped
   keys (`content`, `prompt`, `response`, `messages`, `attachments`,
   `credentials`).
"""

import ast
import io
import tokenize
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tollms.models.conversation import Conversation
from tollms.models.message import Message, MessageStatus, Role
from tollms.models.user import PlatformRole, User

BACKEND_ROOT = Path(__file__).resolve().parents[2]
ADMIN_DIRS = (
    BACKEND_ROOT / "src" / "tollms" / "services" / "admin",
    BACKEND_ROOT / "src" / "tollms" / "api" / "admin",
)

BANNED_SUBSTRINGS = (
    "Message.content",
    "conversation.title",
    "storage_path",
    "extracted_text",
    "decrypt",
    "credentials",
    "api_key",
    "password_hash",
    "prompt=",
)

BANNED_KEYS = {"content", "prompt", "response", "messages", "attachments", "credentials"}

ADMIN_ENDPOINTS = (
    "/api/admin/dashboard",
    "/api/admin/usage",
    "/api/admin/models",
    "/api/admin/providers",
    "/api/admin/users",
    "/api/admin/costs",
    "/api/admin/tokens",
    "/api/admin/cache",
    "/api/admin/media",
    "/api/admin/errors",
    "/api/admin/health",
)

WINDOW = {"preset": "last_7d", "timezone": "UTC", "limit": 50}

_RUN = uuid.uuid4().hex[:8]
USER_CONTENT_MARKER = f"private-user-content-{_RUN}"
ASSISTANT_CONTENT_MARKER = f"private-assistant-content-{_RUN}"
CONVERSATION_TITLE_MARKER = f"private-conversation-title-{_RUN}"
CREDENTIAL_MARKER = f"sk-private-credential-{_RUN}"
CONTENT_MARKERS = (
    USER_CONTENT_MARKER,
    ASSISTANT_CONTENT_MARKER,
    CONVERSATION_TITLE_MARKER,
)


# --- layer 1: static scan ----------------------------------------------------


def _masked_source(source: str) -> str:
    """Blank out docstrings and comments; only live code and SQL strings remain."""
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return source
    lines = [list(line) for line in source.splitlines()]

    def blank(start_line: int, start_col: int, end_line: int, end_col: int) -> None:
        for lineno in range(start_line, end_line + 1):
            if not 1 <= lineno <= len(lines):
                continue
            row = lines[lineno - 1]
            lo = start_col if lineno == start_line else 0
            hi = end_col if lineno == end_line else len(row)
            for index in range(lo, min(hi, len(row))):
                row[index] = " "

    for node in ast.walk(tree):
        if not isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        body = getattr(node, "body", [])
        if not body:
            continue
        first = body[0]
        value = getattr(first, "value", None)
        if isinstance(first, ast.Expr) and isinstance(value, ast.Constant) and isinstance(value.value, str):
            blank(
                value.lineno,
                value.col_offset,
                value.end_lineno or value.lineno,
                value.end_col_offset or value.col_offset,
            )

    try:
        for token in tokenize.generate_tokens(io.StringIO(source).readline):
            if token.type == tokenize.COMMENT:
                blank(token.start[0], token.start[1], token.end[0], token.end[1])
    except (tokenize.TokenError, IndentationError):
        pass

    return "\n".join("".join(row) for row in lines)


def test_admin_modules_never_touch_private_content_or_credentials() -> None:
    offenders: list[str] = []
    for directory in ADMIN_DIRS:
        for path in sorted(directory.rglob("*.py")):
            scanned = _masked_source(path.read_text(encoding="utf-8"))
            for banned in BANNED_SUBSTRINGS:
                if banned in scanned:
                    offenders.append(f"{path.relative_to(BACKEND_ROOT)}: contains {banned!r}")

    assert not offenders, (
        "admin modules must never read message content, prompts, responses, "
        "attachment bytes/storage paths or provider credentials:\n" + "\n".join(offenders)
    )


# --- seeding -----------------------------------------------------------------


def _promote(db: Session, user_id: str) -> None:
    user = db.get(User, uuid.UUID(user_id))
    assert user is not None, "signup did not persist the user"
    user.platform_role = PlatformRole.PLATFORM_ADMIN
    db.commit()


def _seed_markers(client: TestClient, db: Session, user_factory, provider_factory, model_factory) -> None:
    """Create content/credential markers behind every admin endpoint's data."""
    user = user_factory("privacy-audit@tollma.ai")
    uid = uuid.UUID(user["id"])
    provider = provider_factory(
        "Privacy Provider",
        creds={"base_url": "http://mock", "api_key": CREDENTIAL_MARKER},
    )
    model = model_factory(provider["id"], model_id="privacy-model", name="Privacy Model")

    conversation = Conversation(user_id=uid, title=CONVERSATION_TITLE_MARKER)
    db.add(conversation)
    db.commit()
    db.refresh(conversation)

    now = datetime.now(timezone.utc) - timedelta(hours=1)
    for role, content in ((Role.USER, USER_CONTENT_MARKER), (Role.ASSISTANT, ASSISTANT_CONTENT_MARKER)):
        db.add(
            Message(
                user_id=uid,
                conversation_id=conversation.id,
                role=role,
                content=content,
                provider_id=uuid.UUID(provider["id"]),
                model_id=uuid.UUID(model["id"]),
                status=MessageStatus.COMPLETED,
                created_at=now,
                completed_at=now,
                prompt_tokens=11,
                completion_tokens=5,
                total_tokens=16,
                input_cost=Decimal("0.01"),
                output_cost=Decimal("0.01"),
                total_cost=Decimal("0.02"),
            )
        )
    db.commit()

    _promote(db, user["id"])


# --- layer 2 + 3: runtime response scan --------------------------------------


def test_admin_responses_never_leak_content_or_credentials(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory
) -> None:
    _seed_markers(client, db, user_factory, provider_factory, model_factory)

    for path in ADMIN_ENDPOINTS:
        r = client.get(path, params=WINDOW)
        assert r.status_code == 200, f"{path}: {r.status_code}: {r.text}"
        for marker in (*CONTENT_MARKERS, CREDENTIAL_MARKER):
            assert marker not in r.text, f"{path} leaked private data marker {marker!r}"


def _walk_keys(value, prefix: str = ""):
    if isinstance(value, dict):
        for key, item in value.items():
            dotted = f"{prefix}.{key}"
            yield dotted
            yield from _walk_keys(item, dotted)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from _walk_keys(item, f"{prefix}[{index}]")


def test_admin_responses_have_no_content_shaped_keys(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory
) -> None:
    _seed_markers(client, db, user_factory, provider_factory, model_factory)

    offenders: list[str] = []
    for path in ADMIN_ENDPOINTS:
        r = client.get(path, params=WINDOW)
        assert r.status_code == 200, f"{path}: {r.status_code}: {r.text}"
        for dotted in _walk_keys(r.json()):
            leaf = dotted.rsplit(".", 1)[-1].split("[", 1)[0]
            if leaf in BANNED_KEYS:
                offenders.append(f"{path}: {dotted}")

    assert not offenders, "admin responses must be aggregate-only:\n" + "\n".join(offenders)
