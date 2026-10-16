"""Org provider wizard registration body."""

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from tollms.api.providers.schemas import RegisterModelItem
from tollms.models.provider import ProviderType


class OrgProviderRegister(BaseModel):
    """Atomic org wizard registration body. Mirrors providers.ProviderRegister
    exactly, plus optional catalog_slug. `org_id` comes ONLY from the URL
    path: extra fields (including org_id) are rejected with 422."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=255)
    provider_type: ProviderType
    description: str | None = None
    credentials: dict[str, Any]
    metadata: dict[str, Any] = Field(default_factory=dict)
    validation_status: str | None = None
    validation_message: str | None = None
    models: list[RegisterModelItem] = Field(default_factory=list)
    catalog_slug: str | None = None

