"""Media generation: endpoint-aware gateway calls that persist the result.

Images and videos are generated through the same adapter factory/dispatch as
chat, then stored as attachments so the UI can preview and download them with
the normal authenticated content endpoint.
"""

import logging
import time
import uuid

import httpx
from sqlalchemy.orm import Session

from tollms.api.attachments import service as attachment_service
from tollms.api.gateway.service import _resolve
from tollms.api.media.schemas import ImageGenerateRequest, VideoGenerateRequest
from tollms.api.providers.service import decrypted_credentials
from tollms.core.exceptions import ProviderError, ValidationError
from tollms.services.gateway.dispatch import call_endpoint
from tollms.services.gateway.factory import build_adapter

logger = logging.getLogger(__name__)

IMAGE_ENDPOINT = "images/generations"
VIDEO_ENDPOINT = "video/generations"


def _adapter_for(db: Session, provider_id: uuid.UUID, model_id: uuid.UUID, endpoint: str, user_id):
    provider, model = _resolve(db, provider_id, model_id, user_id)
    supported = set(model.supported_endpoints or []) | {model.primary_endpoint or ""}
    if endpoint not in supported:
        raise ValidationError(
            f"model {model.model_id} does not support {endpoint} (has: {sorted(supported - {''})})"
        )
    adapter = build_adapter(provider, model, decrypted_credentials(provider))
    return adapter, model


async def generate_image(
    db: Session, data: ImageGenerateRequest, user_id: uuid.UUID | None = None
) -> tuple[object, float]:
    adapter, model = _adapter_for(db, data.provider_id, data.model_id, IMAGE_ENDPOINT, user_id)
    started = time.monotonic()
    try:
        image = await call_endpoint(
            adapter, IMAGE_ENDPOINT, prompt=data.prompt, options={"size": data.size, "quality": data.quality}
        )
    except RuntimeError as exc:
        raise ProviderError(str(exc)) from exc
    except httpx.HTTPError as exc:
        raise ProviderError(f"provider transport failure: {exc}") from exc
    latency = (time.monotonic() - started) * 1000
    filename = f"{model.model_id}-{uuid.uuid4().hex[:8]}.png"
    attachment = attachment_service.upload_attachment(
        db, user_id=user_id, filename=filename, content_type="image/png", data=image
    )
    logger.info("image generated: model=%s bytes=%s latency=%.0fms", model.model_id, len(image), latency)
    return attachment, latency


async def generate_video(
    db: Session, data: VideoGenerateRequest, user_id: uuid.UUID | None = None
) -> tuple[object, float]:
    adapter, model = _adapter_for(db, data.provider_id, data.model_id, VIDEO_ENDPOINT, user_id)
    options: dict = {"size": data.size, "seconds": data.seconds}
    if data.reference_attachment_id is not None:
        reference, content = attachment_service.read_content(db, data.reference_attachment_id, user_id)
        options.update(
            {
                "image": content,
                "image_filename": reference.filename,
                "image_mime": reference.mime_type,
            }
        )
    started = time.monotonic()
    try:
        video = await call_endpoint(adapter, VIDEO_ENDPOINT, prompt=data.prompt, options=options)
    except RuntimeError as exc:
        # Provider-side job failures are upstream errors, not 500s.
        raise ProviderError(str(exc)) from exc
    except httpx.HTTPError as exc:
        raise ProviderError(f"provider transport failure: {exc}") from exc
    latency = (time.monotonic() - started) * 1000
    filename = f"{model.model_id}-{uuid.uuid4().hex[:8]}.mp4"
    attachment = attachment_service.upload_attachment(
        db, user_id=user_id, filename=filename, content_type="video/mp4", data=video
    )
    logger.info("video generated: model=%s bytes=%s latency=%.0fms", model.model_id, len(video), latency)
    return attachment, latency
