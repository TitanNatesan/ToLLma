#!/usr/bin/env python
"""Low-cost live endpoint validation across provider families.

Every probe is deliberately tiny: 16 output tokens for chat, a 1x1 PNG for
vision, one lowest-quality image, one short embedding, one second of silence
for transcription and a two-word speech request. Without credentials (or
without `--live`) the script prints the plan and reports SKIPPED entries.

Usage (inside the backend container):
    python scripts/validate_endpoints.py                 # dry run / plan
    python scripts/validate_endpoints.py --live          # tiny live calls
    python scripts/validate_endpoints.py --live --report docs/validation-report.md

Environment:
    Provider keys: OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY,
                   AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY/AWS_REGION (Bedrock),
                   VERTEX_PROJECT/VERTEX_LOCATION/VERTEX_CREDENTIALS_JSON,
                   CUSTOM_BASE_URL (optional CUSTOM_API_KEY).
    Model overrides: TOLLMA_VALIDATE_<FAMILY>_<KIND> e.g.
        TOLLMA_VALIDATE_OPENAI_CHAT, TOLLMA_VALIDATE_OPENAI_EMBEDDINGS,
        TOLLMA_VALIDATE_OPENAI_IMAGES, TOLLMA_VALIDATE_OPENAI_AUDIO.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import io
import os
import struct
import sys
import wave
from dataclasses import dataclass, field
from datetime import datetime, timezone

from tollms.models.provider import Provider, ProviderType
from tollms.models.registered_model import endpoint_enum
from tollms.services.gateway.adapters.base import ChatMessage, MediaPart
from tollms.services.gateway.dispatch import call_endpoint
from tollms.services.gateway.factory import build_adapter

CHAT_PROMPT = "Say Hello"
EMBED_INPUT = "hello"
IMAGE_PROMPT = "green circle"
SPEECH_TEXT = "hello"
MAX_OUTPUT_TOKENS = 16

TINY_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)

# Cheapest known model per family/kind; every one is env-overridable.
DEFAULT_MODELS = {
    "OPENAI": {
        "chat": "gpt-4o-mini",
        "embeddings": "text-embedding-3-small",
        "images": "gpt-image-1",
        "transcriptions": "whisper-1",
        "speech": "tts-1",
        "video": "sora-2",
    },
    "ANTHROPIC_MESSAGES": {"chat": "claude-3-5-haiku-latest"},
    "GEMINI": {"chat": "gemini-2.0-flash-lite"},
    "VERTEX_AI": {"chat": "gemini-2.0-flash-lite"},
    "BEDROCK_CONVERSE": {"chat": "anthropic.claude-3-haiku-20240307-v1:0"},
    "CUSTOM": {"chat": "local-model", "embeddings": "local-embedding"},
}


def _model_override(family: str, kind: str) -> str | None:
    return os.getenv(f"TOLLMA_VALIDATE_{family}_{kind.upper()}")


def _tiny_wav() -> bytes:
    """0.3s of 16kHz mono silence — the smallest realistic audio fixture."""
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(16000)
        handle.writeframes(struct.pack("<h", 0) * 4800)
    return buffer.getvalue()


def _credentials(family: str) -> dict | None:
    """Provider credentials from the environment. None = family skipped."""
    if family == "OPENAI":
        key = os.getenv("OPENAI_API_KEY")
        return {"api_key": key} if key else None
    if family == "ANTHROPIC_MESSAGES":
        key = os.getenv("ANTHROPIC_API_KEY")
        return {"api_key": key} if key else None
    if family == "GEMINI":
        key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
        return {"api_key": key} if key else None
    if family == "VERTEX_AI":
        project = os.getenv("VERTEX_PROJECT")
        credentials_json = os.getenv("VERTEX_CREDENTIALS_JSON")
        if not project or not credentials_json:
            return None
        return {
            "project_id": project,
            "location": os.getenv("VERTEX_LOCATION", "us-central1"),
            "credentials_json": credentials_json,
        }
    if family == "BEDROCK_CONVERSE":
        access = os.getenv("AWS_ACCESS_KEY_ID")
        secret = os.getenv("AWS_SECRET_ACCESS_KEY")
        if not access or not secret:
            return None
        return {
            "access_key": access,
            "secret_key": secret,
            "region": os.getenv("AWS_REGION", "us-east-1"),
        }
    if family == "CUSTOM":
        base_url = os.getenv("CUSTOM_BASE_URL")
        if not base_url:
            return None
        return {"base_url": base_url, "api_key": os.getenv("CUSTOM_API_KEY", "")}
    return None


@dataclass
class Probe:
    family: str
    kind: str  # chat | vision | embeddings | images | transcriptions | speech
    endpoint: str
    model_id: str
    kwargs: dict = field(default_factory=dict)


def _stub_model(endpoint: str, model_id: str):
    return type(
        "StubModel",
        (),
        {"model_id": model_id, "primary_endpoint": endpoint, "endpoint_type": endpoint_enum(endpoint)},
    )()


def build_plan() -> list[Probe]:
    plan: list[Probe] = []
    vision_message = ChatMessage(
        role="user",
        content="What do you see?",
        media=[MediaPart(kind="image", mime_type="image/png", data_b64=base64.b64encode(TINY_PNG).decode())],
    )
    for family, kinds in DEFAULT_MODELS.items():
        chat_model = _model_override(family, "chat") or kinds["chat"]
        plan.append(
            Probe(family, "chat", "chat_completions", chat_model, {"messages": [ChatMessage("user", CHAT_PROMPT)]})
        )
        # Vision rides the chat endpoint when the family supports it.
        if family in ("OPENAI", "ANTHROPIC_MESSAGES", "GEMINI", "VERTEX_AI"):
            endpoint = "messages" if family == "ANTHROPIC_MESSAGES" else "chat_completions"
            plan.append(Probe(family, "vision", endpoint, chat_model, {"messages": [vision_message]}))
        if "embeddings" in kinds:
            model = _model_override(family, "embeddings") or kinds["embeddings"]
            plan.append(Probe(family, "embeddings", "embeddings", model, {"inputs": [EMBED_INPUT]}))
        if "images" in kinds:
            model = _model_override(family, "images") or kinds["images"]
            plan.append(
                Probe(
                    family,
                    "images",
                    "images/generations",
                    model,
                    {"prompt": IMAGE_PROMPT, "options": {"size": "1024x1024", "quality": "low"}},
                )
            )
        if "transcriptions" in kinds:
            model = _model_override(family, "transcriptions") or kinds["transcriptions"]
            plan.append(
                Probe(
                    family,
                    "transcriptions",
                    "audio/transcriptions",
                    model,
                    {"audio": _tiny_wav(), "filename": "silence.wav", "mime_type": "audio/wav"},
                )
            )
        if "speech" in kinds:
            model = _model_override(family, "speech") or kinds["speech"]
            plan.append(
                Probe(family, "speech", "audio/speech", model, {"text": SPEECH_TEXT, "options": {"voice": "alloy"}})
            )
        # Video is opt-in: a single Sora job is the most expensive probe.
        if "video" in kinds and os.getenv("TOLLMA_VALIDATE_INCLUDE_VIDEO"):
            model = _model_override(family, "video") or kinds["video"]
            plan.append(
                Probe(
                    family,
                    "video",
                    "video/generations",
                    model,
                    {"prompt": "a green circle pulsing", "options": {"size": "1280x720", "seconds": "4"}},
                )
            )
    return plan


def _result_summary(probe: Probe, result) -> str:
    if probe.kind in ("chat", "vision"):
        return f"text={getattr(result, 'text', '')!r} tokens={getattr(result, 'total_tokens', None)}"
    if probe.kind == "embeddings":
        return f"vectors={len(result)} dims={len(result[0]) if result else 0}"
    if probe.kind == "images":
        return f"image_bytes={len(result)}"
    if probe.kind == "transcriptions":
        return f"text={result!r}"
    if probe.kind == "video":
        return f"video_bytes={len(result)}"
    return f"audio_bytes={len(result)}"


def run(live: bool) -> list[dict]:
    plan = build_plan()
    outcomes: list[dict] = []
    for probe in plan:
        record = {"probe": probe, "status": "SKIPPED", "detail": "no credentials", "error": None}
        credentials = _credentials(probe.family)
        if credentials is None:
            outcomes.append(record)
            continue
        if not live:
            record.update(status="PLANNED", detail=f"model={probe.model_id} endpoint={probe.endpoint}")
            outcomes.append(record)
            continue
        try:
            provider = Provider(
                name=f"validate-{probe.family}", provider_type=ProviderType(probe.family), credentials_encrypted="", metadata_={}
            )
            adapter = build_adapter(provider, _stub_model(probe.endpoint, probe.model_id), credentials)
            if probe.kind in ("chat", "vision"):
                adapter.max_output_tokens = MAX_OUTPUT_TOKENS
            result = asyncio.run(call_endpoint(adapter, probe.endpoint, **probe.kwargs))
            record.update(status="PASS", detail=_result_summary(probe, result))
        except Exception as exc:  # never abort the suite on one provider
            record.update(status="FAIL", detail=str(exc)[:300], error=type(exc).__name__)
        outcomes.append(record)
    return outcomes


def render_report(outcomes: list[dict], live: bool) -> str:
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    lines = [
        "# Provider & Endpoint Validation Report",
        "",
        f"- Generated: {now}",
        f"- Mode: {'live probes' if live else 'dry run (no API calls)'}",
        f"- Probes: {len(outcomes)}",
        "",
        "## Provider coverage",
        "",
        "| Provider | Status | Detail |",
        "| --- | --- | --- |",
    ]
    families = sorted({record["probe"].family for record in outcomes})
    for family in families:
        family_records = [r for r in outcomes if r["probe"].family == family]
        statuses = {r["status"] for r in family_records}
        status = "PASS" if statuses == {"PASS"} else ("FAIL" if "FAIL" in statuses else next(iter(statuses)))
        kinds = ", ".join(f"{r['probe'].kind}={r['status']}" for r in family_records)
        lines.append(f"| {family} | {status} | {kinds} |")
    lines += [
        "",
        "## Endpoint coverage",
        "",
        "| Endpoint | Probes | Passed |",
        "| --- | --- | --- |",
    ]
    endpoints = sorted({r["probe"].endpoint for r in outcomes})
    for endpoint in endpoints:
        subset = [r for r in outcomes if r["probe"].endpoint == endpoint]
        lines.append(
            f"| {endpoint} | {len(subset)} | {sum(1 for r in subset if r['status'] == 'PASS')} |"
        )
    passed = [r for r in outcomes if r["status"] == "PASS"]
    failed = [r for r in outcomes if r["status"] == "FAIL"]
    skipped = [r for r in outcomes if r["status"] in ("SKIPPED", "PLANNED")]
    lines += [
        "",
        "## Results",
        "",
        f"- Tests passed: {len(passed)}",
        f"- Tests failed: {len(failed)}",
        f"- Skipped / planned: {len(skipped)}",
        "",
        "## Estimated cost",
        "",
        f"- Chat probes capped at {MAX_OUTPUT_TOKENS} output tokens with the cheapest chat model available.",
        "- Vision uses a 1x1 PNG; image generation uses one image at lowest quality; audio uses <1s fixtures.",
        "- Live chat token usage is reported per probe above; total expected cost is fractions of a cent.",
        "",
        "## Missing features / recommendations",
        "",
    ]
    if not live:
        lines.append("- Run with `--live` and provider keys set to turn the plan into real probes.")
    if skipped:
        lines.append(
            "- Providers without credentials: "
            + ", ".join(sorted({r["probe"].family for r in skipped if r["status"] == "SKIPPED"}))
        )
    for record in failed:
        lines.append(
            f"- {record['probe'].family}/{record['probe'].kind} failed ({record['error']}): {record['detail']}"
        )
    if live and not failed:
        lines.append("- All live probes passed; no regressions detected.")
    lines.append("- Video generation remains future work; the endpoint vocabulary already accepts it.")
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true", help="perform tiny live API calls")
    parser.add_argument("--report", help="write the markdown report to this path")
    args = parser.parse_args()

    outcomes = run(live=args.live)
    report = render_report(outcomes, live=args.live)
    if args.report:
        with open(args.report, "w", encoding="utf-8") as handle:
            handle.write(report)
        print(f"report written to {args.report}")
    print(report)
    if args.live and any(record["status"] == "FAIL" for record in outcomes):
        return 1
    if not outcomes:
        print("No credentials found for any provider family.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
