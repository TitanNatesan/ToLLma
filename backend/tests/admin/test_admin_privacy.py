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
import re
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
    "/api/admin/api-keys",
)
# SSE telemetry: not a JSON object, so it is scanned from its first streamed
# frame (see `_first_sse_frame_text`) rather than from a buffered response.
STREAM_PATH = "/api/admin/health/stream"

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


# The API-key inventory identifiers (`api_keys` module/engine/service names,
# `apikeys` engine alias, `ApiKey(s)` model/schema names) are aggregate
# plumbing, not secret reads — strip them before the `api_key` substring
# check so a bare singular `api_key` (an actual credential read) still trips
# the scanner while the inventory modules stop false-positive matching.
_API_KEY_INVENTORY_RE = re.compile(r"api_keys|apikeys|ApiKeys?|API_KEYS?")


def _scan_text(relative: str, scanned: str) -> list[str]:
    """Banned-substring offenders for one masked module source."""
    offenders: list[str] = []
    for banned in BANNED_SUBSTRINGS:
        haystack = _API_KEY_INVENTORY_RE.sub(" ", scanned) if banned == "api_key" else scanned
        if banned in haystack:
            offenders.append(f"{relative}: contains {banned!r}")
    return offenders


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
            offenders.extend(_scan_text(str(path.relative_to(BACKEND_ROOT)), scanned))

    assert not offenders, (
        "admin modules must never read message content, prompts, responses, "
        "attachment bytes/storage paths or provider credentials:\n" + "\n".join(offenders)
    )


def test_scanner_allows_inventory_identifiers() -> None:
    """Negative control: the `api_keys` inventory plumbing is not a violation."""
    snippet = _masked_source(
        "from tollms.services.admin import api_keys as api_keys_service\n"
        "from tollms.services.analytics import apikeys as apikeys_engine\n"
        "from tollms.api.admin.schemas import AdminApiKeys, AdminApiKeyUsageRow\n"
        "def api_keys(db, window):\n"
        "    rows = apikeys_engine.key_breakdown(db, window)\n"
        "    model = ApiKey(name='x')\n"
        "    return api_keys_service.api_keys(db, window)\n"
    )
    assert _scan_text("synthetic_inventory.py", snippet) == []


def test_scanner_still_flags_true_violations() -> None:
    """Positive control: real content/credential reads still trip the scanner."""
    snippet = _masked_source(
        "text = Message.content\n"
        "title = conversation.title\n"
        "raw = decrypt(provider.credentials_encrypted)\n"
        "key = creds['api_key']\n"
        "blob = row.storage_path\n"
    )
    offenders = _scan_text("synthetic_offender.py", snippet)
    flagged = {o.rsplit("contains", 1)[-1].strip() for o in offenders}
    for banned in ("'Message.content'", "'conversation.title'", "'decrypt'", "'api_key'", "'storage_path'"):
        assert banned in flagged, f"scanner missed {banned}: {offenders}"
    # `credentials` is covered through the decrypt line's attribute access.
    assert "'credentials'" in flagged, f"scanner missed 'credentials': {offenders}"


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


def _first_sse_frame_text(client: TestClient) -> str:
    """First streamed frame of the admin health stream as raw SSE text.

    `TestClient` buffers a response until the app returns, which an
    open-ended SSE stream never does, so this drives the real ASGI interface
    through the TestClient portal and disconnects after the first frame.
    """
    import asyncio
    from typing import Any

    from tollms.main import app

    cookie = "; ".join(f"{name}={value}" for name, value in client.cookies.items())
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": STREAM_PATH,
        "raw_path": STREAM_PATH.encode("latin-1"),
        "query_string": b"",
        "root_path": "",
        "headers": [
            (b"host", b"testserver"),
            (b"cookie", cookie.encode("latin-1")),
        ],
        "client": ("testclient", 50000),
        "server": ("testserver", 80),
    }
    events: list[dict[str, Any]] = []
    queue: asyncio.Queue = asyncio.Queue()
    queue.put_nowait({"type": "http.request", "body": b"", "more_body": False})

    async def receive() -> dict[str, Any]:
        return await queue.get()

    async def send(message: dict[str, Any]) -> None:
        events.append(message)
        if message["type"] == "http.response.body" and message.get("body"):
            queue.put_nowait({"type": "http.disconnect"})

    async def run() -> None:
        await app(scope, receive, send)

    assert client.portal is not None
    client.portal.call(run)
    start = next(e for e in events if e["type"] == "http.response.start")
    assert start["status"] == 200, f"{STREAM_PATH}: {start['status']}"
    return b"".join(
        e.get("body", b"") for e in events if e["type"] == "http.response.body"
    ).decode()


def _first_sse_payload(client: TestClient) -> dict:
    """First streamed frame parsed as JSON (`data: {...}`)."""
    import json

    text = _first_sse_frame_text(client)
    frames = [frame for frame in text.split("\n\n") if frame]
    assert frames and frames[0].startswith("data: "), f"{STREAM_PATH}: no SSE frame streamed"
    payload = json.loads(frames[0][len("data: "):])
    assert isinstance(payload, dict)
    return payload


def test_admin_responses_never_leak_content_or_credentials(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory
) -> None:
    _seed_markers(client, db, user_factory, provider_factory, model_factory)

    for path in ADMIN_ENDPOINTS:
        r = client.get(path, params=WINDOW)
        assert r.status_code == 200, f"{path}: {r.status_code}: {r.text}"
        for marker in (*CONTENT_MARKERS, CREDENTIAL_MARKER):
            assert marker not in r.text, f"{path} leaked private data marker {marker!r}"

    # The stream is live server/process telemetry, never content — scan its
    # first frame the same way.
    text = _first_sse_frame_text(client)
    for marker in (*CONTENT_MARKERS, CREDENTIAL_MARKER):
        assert marker not in text, f"{STREAM_PATH} leaked private data marker {marker!r}"


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

    for dotted in _walk_keys(_first_sse_payload(client)):
        leaf = dotted.rsplit(".", 1)[-1].split("[", 1)[0]
        if leaf in BANNED_KEYS:
            offenders.append(f"{STREAM_PATH}: {dotted}")

    assert not offenders, "admin responses must be aggregate-only:\n" + "\n".join(offenders)
