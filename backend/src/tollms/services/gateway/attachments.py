"""Attachment engine: validation, disk storage, text extraction, transcription.

Pure infrastructure — no API or ORM imports. The `api/attachments` feature
service owns rows; the gateway owns prompt assembly. Text extraction is
stdlib-only except PDF (pypdf); video helpers shell out to ffmpeg when
present and degrade to None otherwise (never raise).
"""

import csv
import io
import logging
import re
import shutil
import subprocess
import uuid
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

import httpx

from tollms.core.config import get_settings
from tollms.core.exceptions import ProviderError, ValidationError

logger = logging.getLogger(__name__)

MAX_TEXT_CHARS = 100_000

EXT_KIND: dict[str, str] = {
    **dict.fromkeys(["png", "jpg", "jpeg", "gif", "webp"], "image"),
    **dict.fromkeys(["pdf", "docx", "txt", "csv", "xlsx", "pptx", "json", "md"], "document"),
    **dict.fromkeys(["mp3", "wav", "ogg", "m4a", "flac"], "audio"),
    **dict.fromkeys(["mp4", "webm", "mov", "avi"], "video"),
}

# (offset, magic) pairs checked when the header is long enough. A positive
# mismatch rejects the upload; unknown/short headers pass (extension wins).
MAGIC: dict[str, list[tuple[int, bytes]]] = {
    "png": [(0, b"\x89PNG")],
    "jpg": [(0, b"\xff\xd8")],
    "jpeg": [(0, b"\xff\xd8")],
    "gif": [(0, b"GIF8")],
    "webp": [(0, b"RIFF"), (8, b"WEBP")],
    "pdf": [(0, b"%PDF")],
    "docx": [(0, b"PK\x03\x04")],
    "xlsx": [(0, b"PK\x03\x04")],
    "pptx": [(0, b"PK\x03\x04")],
    "mp3": [(0, b"ID3"), (0, b"\xff\xfb")],
    "wav": [(0, b"RIFF")],
    "ogg": [(0, b"OggS")],
    "flac": [(0, b"fLaC")],
    "m4a": [(4, b"ftyp")],
    "mp4": [(4, b"ftyp")],
    "mov": [(4, b"ftyp")],
    "webm": [(0, b"\x1a\x45\xdf\xa3")],
    "avi": [(0, b"RIFF"), (8, b"AVI ")],
}


def detect_kind(filename: str) -> str:
    """Kind from extension only. Raises ValidationError for unknown types."""
    ext = (filename.rsplit(".", 1)[-1] if "." in filename else "").lower()
    kind = EXT_KIND.get(ext)
    if kind is None:
        raise ValidationError(f"unsupported attachment type: {filename or '(no name)'}")
    return kind


def sniff_ok(filename: str, head: bytes) -> bool:
    """True unless magic bytes positively contradict the extension."""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    checks = MAGIC.get(ext)
    if not checks:
        return True
    for offset, magic in checks:
        if len(head) < offset + len(magic):
            continue
        if head[offset : offset + len(magic)] != magic:
            return False
    return True


def max_bytes() -> int:
    return get_settings().max_upload_mb * 1024 * 1024


def storage_root() -> Path:
    root = Path(get_settings().storage_dir)
    root.mkdir(parents=True, exist_ok=True)
    return root


def safe_name(filename: str) -> str:
    base = Path(filename).name.strip() or "upload"
    base = re.sub(r"[^A-Za-z0-9._-]+", "_", base)[:120]
    return base or "upload"


def save_bytes(user_id: uuid.UUID | None, scope: str, filename: str, data: bytes) -> str:
    """Persist bytes under <root>/<user>/<scope>/<uuid>_<safe>. Returns relpath."""
    owner = str(user_id) if user_id else "anonymous"
    rel = Path(owner) / scope / f"{uuid.uuid4().hex}_{safe_name(filename)}"
    dest = storage_root() / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    return rel.as_posix()


def read_bytes(relpath: str) -> bytes:
    """Read bytes by stored relpath. Traversal outside storage_dir is rejected."""
    dest = (storage_root() / relpath).resolve()
    if storage_root().resolve() not in dest.parents:
        raise ValidationError("invalid storage path")
    try:
        return dest.read_bytes()
    except FileNotFoundError:
        raise ValidationError("attachment content is missing from storage") from None


def delete_bytes(relpath: str) -> None:
    try:
        (storage_root() / relpath).unlink(missing_ok=True)
    except Exception:
        logger.warning("attachment file delete failed: %s", relpath, exc_info=True)


def _truncate(text: str) -> str:
    text = text.strip()
    if len(text) > MAX_TEXT_CHARS:
        return text[:MAX_TEXT_CHARS] + f"\n\n[… truncated to {MAX_TEXT_CHARS} chars]"
    return text


def _decode(data: bytes) -> str:
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return data.decode("latin-1")


def _ooxml_texts(zf: zipfile.ZipFile, part: str) -> list[str]:
    """All <*t> runs from one OOXML part. Never raises."""
    try:
        root = ET.fromstring(zf.read(part))
    except Exception:
        return []
    return [n.text or "" for n in root.iter() if n.tag.endswith("}t") and n.text]


def _extract_docx(data: bytes) -> str:
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        return "\n".join(_ooxml_texts(zf, "word/document.xml"))


def _extract_xlsx(data: bytes) -> str:
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        try:
            shared = _ooxml_texts(zf, "xl/sharedStrings.xml")
        except KeyError:
            shared = []
        out: list[str] = []
        for name in zf.namelist():
            if not (name.startswith("xl/worksheets/sheet") and name.endswith(".xml")):
                continue
            try:
                root = ET.fromstring(zf.read(name))
            except Exception:
                continue
            for row in root.iter():
                if not row.tag.endswith("}row"):
                    continue
                cells: list[str] = []
                for c in row:
                    t = c.get("t")
                    v = next((n.text or "" for n in c.iter() if n.tag.endswith("}v")), "")
                    if t == "s" and v.isdigit() and int(v) < len(shared):
                        cells.append(shared[int(v)])
                    elif t == "inlineStr":
                        cells.append(" ".join(n.text or "" for n in c.iter() if n.tag.endswith("}t")))
                    elif v:
                        cells.append(v)
                if cells:
                    out.append(" | ".join(cells))
        return "\n".join([*shared, *out])


def _extract_pptx(data: bytes) -> str:
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        slides = sorted(n for n in zf.namelist() if n.startswith("ppt/slides/slide") and n.endswith(".xml"))
        out = []
        for name in slides:
            text = "\n".join(_ooxml_texts(zf, name))
            if text.strip():
                out.append(text)
        return "\n\n".join(out)


def _extract_csv(data: bytes) -> str:
    rows = list(csv.reader(io.StringIO(_decode(data))))
    return "\n".join(" | ".join(cell.strip() for cell in row) for row in rows if any(c.strip() for c in row))


def _extract_pdf(data: bytes) -> str:
    from pypdf import PdfReader

    try:
        reader = PdfReader(io.BytesIO(data))
        return "\n\n".join((page.extract_text() or "") for page in reader.pages)
    except Exception as e:
        logger.warning("pdf extraction failed: %s", e)
        raise ValidationError("could not extract text from PDF (corrupt or encrypted?)") from e


def extract_text(data: bytes, filename: str) -> str:
    """Document bytes -> plain text. Raises ValidationError on failure."""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    try:
        if ext == "pdf":
            text = _extract_pdf(data)
        elif ext == "docx":
            text = _extract_docx(data)
        elif ext == "xlsx":
            text = _extract_xlsx(data)
        elif ext == "pptx":
            text = _extract_pptx(data)
        elif ext == "csv":
            text = _extract_csv(data)
        else:  # txt, md, json
            text = _decode(data)
    except ValidationError:
        raise
    except Exception as e:
        logger.warning("text extraction failed for %s: %s", filename, e)
        raise ValidationError(f"could not extract text from {filename}") from e
    return _truncate(text)


async def transcribe_audio(
    data: bytes,
    filename: str,
    content_type: str | None,
    *,
    base_url: str,
    api_key: str,
    transport: httpx.AsyncBaseTransport | None = None,
) -> str:
    """Whisper transcription through an OpenAI-compatible endpoint (same creds)."""
    from tollms.core.egress import safe_join

    url = safe_join(base_url, "/audio/transcriptions")
    files = {"file": (filename, data, content_type or "audio/mpeg")}
    try:
        async with httpx.AsyncClient(transport=transport, timeout=180.0) as client:
            r = await client.post(
                url,
                files=files,
                data={"model": "whisper-1"},
                headers={"Authorization": f"Bearer {api_key}"},
            )
    except Exception as e:
        logger.exception("transcription request failed")
        raise ProviderError(f"transcription request failed: {e}") from e
    if r.status_code >= 400:
        logger.warning("transcription rejected (%s): %s", r.status_code, r.text[:200])
        raise ProviderError(f"transcription failed ({r.status_code}): {r.text[:200]}")
    try:
        text = (r.json().get("text") or "").strip()
    except Exception as e:
        raise ProviderError("transcription returned invalid JSON") from e
    if not text:
        raise ProviderError("transcription returned empty text")
    return text


def ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None


def extract_video_frame(data: bytes) -> bytes | None:
    """One downscaled JPEG frame (~1s in). None when ffmpeg is missing/fails."""
    if not ffmpeg_available():
        return None
    try:
        proc = subprocess.run(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", "pipe:0",
             "-ss", "1", "-frames:v", "1", "-vf", "scale=1024:-1", "-f", "mjpeg", "pipe:1"],
            input=data, capture_output=True, timeout=60,
        )
    except Exception:
        logger.warning("video frame extraction failed", exc_info=True)
        return None
    return proc.stdout or None


def extract_video_audio(data: bytes, limit_seconds: int = 300) -> bytes | None:
    """Mono 16kHz WAV of the audio track, capped in duration. None if unavailable."""
    if not ffmpeg_available():
        return None
    try:
        proc = subprocess.run(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", "pipe:0",
             "-vn", "-ac", "1", "-ar", "16000", "-t", str(limit_seconds), "-f", "wav", "pipe:1"],
            input=data, capture_output=True, timeout=120,
        )
    except Exception:
        logger.warning("video audio extraction failed", exc_info=True)
        return None
    return proc.stdout or None


def model_media_flags(model) -> dict[str, bool]:
    """Composer capability flags for one AIModel (mirrors the frontend)."""
    meta = getattr(model, "metadata_", None) or {}
    return {
        "vision": bool(getattr(model, "supports_vision", False)),
        "audio": bool(getattr(model, "supports_audio_input", False)),
        "files": bool(meta.get("supports_files", False)),
        "video": bool(meta.get("supports_video_input", False)),
    }
