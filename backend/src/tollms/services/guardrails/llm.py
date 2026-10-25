"""LLM second-stage evaluator: short safety prompt on the selected provider.

Recursion guard: evaluation sets ctx["skip_guardrails"]; when set, the
orchestrator short-circuits to allow before any evaluator runs, so a policy
that routes through the gateway can never re-enter itself. Bounded to one
attempt (single retry on transport failure only).
"""

import logging
import time
from typing import Any

logger = logging.getLogger(__name__)

_PROMPT = (
    "You are a content safety judge. Reply with exactly one line of JSON: "
    '{"verdict": "allow"|"warn"|"block", "confidence": 0.0-1.0, '
    '"categories": ["..."], "reason": "short excerpt-safe reason"}. '
    "Never repeat the input. Text to judge:\n"
)


async def evaluate(text: str, *, provider_id, model_ref: str | None,
                   ctx: dict[str, Any], timeout_ms: int | None = None,
                   user_id=None, scope_org_id=None) -> dict[str, Any]:
    """Run the safety prompt via the provider's own adapter. Raises on failure.

    `user_id` scopes the provider/model lookup to the caller's workspace
    (404 oracle on cross-tenant ids — never another tenant's spend);
    `scope_org_id` None means personal-only provider semantics, otherwise
    the provider must live in that org.
    """
    # Local imports: services engines never import api/ or tollms.main.
    import json

    from tollms.api.models.service import get_model
    from tollms.api.providers.service import decrypted_credentials, get_provider
    from tollms.db.session import SessionLocal
    from tollms.services.gateway.factory import build_adapter

    from tollms.core.exceptions import NotFoundError

    started = time.monotonic()
    db = SessionLocal()
    try:
        if scope_org_id is None:
            provider = get_provider(db, provider_id, user_id, personal_only=True)
        else:
            provider = get_provider(db, provider_id, user_id)
            if provider.org_id != scope_org_id:
                raise NotFoundError(f"provider {provider_id} not found")
        from sqlalchemy import select

        from tollms.models.registered_model import AIModel

        model = None
        if model_ref is not None:
            try:
                from uuid import UUID

                model = get_model(db, UUID(str(model_ref)), user_id)
            except Exception:
                model = None
            if model is None:
                # Plain model_id string (e.g. "gpt-oss:20b"): resolve it on
                # this provider among live rows, scoped to the caller via the
                # provider lookup above (same pattern as the gateway resolver).
                model = db.scalars(
                    select(AIModel).where(
                        AIModel.provider_id == provider.id,
                        AIModel.model_id == str(model_ref),
                        AIModel.is_deleted.is_(False),
                        AIModel.is_active.is_(True),
                    )
                ).first()
            if model is None:
                raise ValueError(f"llm model not found: {model_ref}")
        else:
            model = db.scalars(
                select(AIModel).where(
                    AIModel.provider_id == provider.id,
                    AIModel.is_deleted.is_(False),
                ).order_by(AIModel.created_at)
            ).first()
        if model is None:
            raise ValueError("no model available for llm evaluation")
        credentials = decrypted_credentials(provider)
        adapter = build_adapter(provider, model, credentials)
        prompt = (_PROMPT + (text or "")[:8000])
        # Recursion guard: the judge prompt must never re-enter guardrails.
        _prev_skip, ctx["skip_guardrails"] = ctx.get("skip_guardrails"), True
        try:
            last: Exception | None = None
            for _ in range(2):  # one attempt + one bounded retry
                try:
                    from tollms.services.gateway.adapters.base import ChatMessage

                    result = await adapter.chat([ChatMessage(role="user", content=prompt)])
                    return _parse(result.text, (time.monotonic() - started) * 1000)
                except Exception as exc:  # transport failure: single retry, then raise
                    last = exc
                    logger.warning("llm evaluator attempt failed", exc_info=True)
            raise last if last else RuntimeError("llm evaluation failed")
        finally:
            if _prev_skip is None:
                ctx.pop("skip_guardrails", None)
            else:
                ctx["skip_guardrails"] = _prev_skip
    finally:
        db.close()


def _parse(raw: str, latency_ms: float) -> dict[str, Any]:
    import json

    try:
        start, end = raw.find("{"), raw.rfind("}")
        data = json.loads(raw[start:end + 1]) if start >= 0 and end > start else {}
    except (ValueError, TypeError):
        data = {}
    verdict = str(data.get("verdict", "allow")).lower()
    if verdict not in ("allow", "warn", "block"):
        verdict = "allow"
    try:
        confidence = float(data.get("confidence", 0.5))
    except (TypeError, ValueError):
        confidence = 0.5
    cats = data.get("categories") or []
    return {
        "verdict": verdict,
        "confidence": confidence,
        "matched_categories": [str(c)[:64] for c in cats][:8],
        "reason": str(data.get("reason", "") or "")[:500],
        "latency_ms": latency_ms,
        "model_version": None,
    }
