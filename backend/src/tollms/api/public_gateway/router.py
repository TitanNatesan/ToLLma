"""Public gateway routes. Thin: translate -> service -> serialize.

Registered with prefix ``/v1`` by the application factory. Authentication is
the `api_key_required` dependency; every shape decision lives in the service
or the shared translators.
"""

import base64
import time
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Request
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy.orm import Session

from tollms.api.public_gateway import service
from tollms.api.public_gateway.schemas import (
    AnthropicMessagesRequest,
    ChatCompletionRequest,
    ImageEditRequest,
    ImageGenerationRequest,
    ResponsesRequest,
    VideoGenerationRequest,
)
from tollms.core.deps import get_db
from tollms.services.gateway import translators
from tollms.services.gateway.unified import UnifiedRequest

router = APIRouter(prefix="/v1", tags=["public-gateway"])

_SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


async def _run(request: Request, db: Session, ctx, unified: UnifiedRequest):
    return await service.execute_unified(db, ctx, unified, service.client_meta(request))


def _stream(result: service.StreamResult) -> StreamingResponse:
    return StreamingResponse(result.iterator, media_type=result.media_type, headers=_SSE_HEADERS)


def _denied(result: service.DeniedResult) -> JSONResponse:
    return JSONResponse(
        content=result.payload, status_code=result.status_code, headers=result.headers
    )


def _created() -> int:
    return int(time.time())


def _chat_completion_payload(outcome: service.ChatOutcome) -> dict:
    tokens = outcome.usage
    return {
        "id": "chatcmpl-" + uuid.uuid4().hex[:24],
        "object": "chat.completion",
        "created": _created(),
        "model": outcome.model_identifier,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": outcome.text},
                "finish_reason": "stop",
            }
        ],
        "usage": {
            "prompt_tokens": tokens.prompt,
            "completion_tokens": tokens.completion,
            "total_tokens": outcome.total_tokens,
            **(
                {"prompt_tokens_details": {"cached_tokens": tokens.cache_read}}
                if tokens.cache_read
                else {}
            ),
        },
    }


def _responses_payload(outcome: service.ChatOutcome) -> dict:
    tokens = outcome.usage
    return {
        "id": "resp_" + uuid.uuid4().hex[:24],
        "object": "response",
        "created_at": _created(),
        "status": "completed",
        "model": outcome.model_identifier,
        "output": [
            {
                "type": "message",
                "id": "msg_" + uuid.uuid4().hex[:24],
                "status": "completed",
                "role": "assistant",
                "content": [{"type": "output_text", "text": outcome.text, "annotations": []}],
            }
        ],
        "output_text": outcome.text,
        "usage": {
            "input_tokens": tokens.prompt,
            "output_tokens": tokens.completion,
            "total_tokens": outcome.total_tokens,
            **(
                {"input_tokens_details": {"cached_tokens": tokens.cache_read}}
                if tokens.cache_read
                else {}
            ),
        },
    }


def _anthropic_payload(outcome: service.ChatOutcome) -> dict:
    tokens = outcome.usage
    payload = {
        "id": "msg_" + uuid.uuid4().hex[:24],
        "type": "message",
        "role": "assistant",
        "model": outcome.model_identifier,
        "content": [{"type": "text", "text": outcome.text}],
        "stop_reason": "end_turn",
        "stop_sequence": None,
        "usage": {"input_tokens": tokens.prompt, "output_tokens": tokens.completion},
    }
    if tokens.cache_read:
        payload["usage"]["cache_read_input_tokens"] = tokens.cache_read
    if tokens.cache_write:
        payload["usage"]["cache_creation_input_tokens"] = tokens.cache_write
    return payload


def _images_payload(outcome: service.MediaOutcome) -> dict:
    return {
        "created": _created(),
        "model": outcome.model_identifier,
        "data": [
            {"b64_json": base64.b64encode(payload).decode("ascii")}
            for payload in outcome.payloads
        ],
    }


def _video_payload(outcome: service.MediaOutcome) -> dict:
    return {
        "id": "video_" + uuid.uuid4().hex[:24],
        "object": "video",
        "created": _created(),
        "status": "completed",
        "model": outcome.model_identifier,
        "data": [
            {"b64_json": base64.b64encode(payload).decode("ascii")}
            for payload in outcome.payloads
        ],
    }


@router.post("/chat/completions")
async def chat_completions(
    data: ChatCompletionRequest,
    request: Request,
    ctx=Depends(service.api_key_required),
    db: Session = Depends(get_db),
):
    unified = translators.from_openai_chat(data.model_dump())
    result = await _run(request, db, ctx, unified)
    if isinstance(result, service.DeniedResult):
        return _denied(result)
    if isinstance(result, service.StreamResult):
        return _stream(result)
    return _chat_completion_payload(result)


@router.post("/responses")
async def responses(
    data: ResponsesRequest,
    request: Request,
    ctx=Depends(service.api_key_required),
    db: Session = Depends(get_db),
):
    unified = translators.from_responses(data.model_dump())
    result = await _run(request, db, ctx, unified)
    if isinstance(result, service.DeniedResult):
        return _denied(result)
    if isinstance(result, service.StreamResult):
        return _stream(result)
    return _responses_payload(result)


@router.post("/messages")
async def messages(
    data: AnthropicMessagesRequest,
    request: Request,
    ctx=Depends(service.api_key_required),
    db: Session = Depends(get_db),
    anthropic_version: Annotated[str | None, Header(alias="anthropic-version")] = None,
):
    """Anthropic Messages shape. `anthropic-version` is accepted, not required."""
    unified = translators.from_anthropic_messages(data.model_dump())
    result = await _run(request, db, ctx, unified)
    if isinstance(result, service.DeniedResult):
        return _denied(result)
    if isinstance(result, service.StreamResult):
        return _stream(result)
    return _anthropic_payload(result)


@router.get("/me")
async def key_identity(
    ctx=Depends(service.api_key_required),
    db: Session = Depends(get_db),
):
    return service.key_identity(db, ctx)


@router.get("/models")
async def list_models(
    ctx=Depends(service.api_key_required),
    db: Session = Depends(get_db),
):
    data = []
    for provider, model in service.list_public_models(db, ctx):
        data.append(
            {
                "id": f"{provider.name}/{model.model_id}",
                "object": "model",
                "created": int(model.created_at.timestamp()) if model.created_at else 0,
                "owned_by": provider.name,
                "display_name": model.name,
                "type": "model",
            }
        )
    return {"object": "list", "data": data}


@router.post("/images/generations")
async def images_generations(
    data: ImageGenerationRequest,
    request: Request,
    ctx=Depends(service.api_key_required),
    db: Session = Depends(get_db),
):
    unified = translators.from_images(data.model_dump(), edits=False)
    result = await _run(request, db, ctx, unified)
    if isinstance(result, service.DeniedResult):
        return _denied(result)
    return _images_payload(result)


@router.post("/images/edits")
async def images_edits(
    data: ImageEditRequest,
    request: Request,
    ctx=Depends(service.api_key_required),
    db: Session = Depends(get_db),
):
    unified = translators.from_images(data.model_dump(), edits=True)
    result = await _run(request, db, ctx, unified)
    if isinstance(result, service.DeniedResult):
        return _denied(result)
    return _images_payload(result)


@router.post("/videos/generations")
async def videos_generations(
    data: VideoGenerationRequest,
    request: Request,
    ctx=Depends(service.api_key_required),
    db: Session = Depends(get_db),
):
    unified = translators.from_videos(data.model_dump())
    result = await _run(request, db, ctx, unified)
    if isinstance(result, service.DeniedResult):
        return _denied(result)
    return _video_payload(result)
