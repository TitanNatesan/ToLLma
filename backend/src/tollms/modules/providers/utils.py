"""Provider credential validation. One lightweight live call per type."""

import json
import logging
import time

import httpx

from tollms.modules.providers.models import ProviderType

logger = logging.getLogger(__name__)
TIMEOUT = 10.0


def _get(url: str, **kwargs) -> tuple[bool, str, float]:
    start = time.monotonic()
    try:
        r = httpx.get(url, timeout=TIMEOUT, **kwargs)
        ms = (time.monotonic() - start) * 1000
        if r.status_code < 400:
            return True, "credentials valid", ms
        logger.warning("credential validation %s -> %s: %s", url, r.status_code, r.text[:200])
        return False, f"provider rejected credentials ({r.status_code})", ms
    except Exception as e:
        logger.exception("credential validation failed for %s", url)
        return False, f"validation request failed: {e}", (time.monotonic() - start) * 1000


def validate_credentials(provider_type: ProviderType, creds: dict) -> tuple[bool, str, float]:
    """Returns (valid, message, latency_ms). Never raises."""
    if provider_type in (ProviderType.OPENAI_CHAT, ProviderType.OPENAI_RESPONSES):
        if not creds.get("api_key"):
            return False, "api_key is required", 0
        return _get("https://api.openai.com/v1/models", headers={"Authorization": f"Bearer {creds['api_key']}"})
    if provider_type == ProviderType.ANTHROPIC_MESSAGES:
        if not creds.get("api_key"):
            return False, "api_key is required", 0
        return _get(
            "https://api.anthropic.com/v1/models",
            headers={"x-api-key": creds["api_key"], "anthropic-version": "2023-06-01"},
        )
    if provider_type == ProviderType.GEMINI:
        if not creds.get("api_key"):
            return False, "api_key is required", 0
        return _get(f"https://generativelanguage.googleapis.com/v1beta/models?key={creds['api_key']}")
    if provider_type == ProviderType.VERTEX_AI:
        missing = [k for k in ("project_id", "location", "credentials_json") if not creds.get(k)]
        if missing:
            return False, f"missing fields: {', '.join(missing)}", 0
        try:
            info = json.loads(creds["credentials_json"])
            if info.get("type") != "service_account" or not info.get("private_key"):
                return False, "credentials_json is not a service-account key", 0
        except json.JSONDecodeError:
            return False, "credentials_json is not valid JSON", 0
        return True, "service-account key structure valid (live check needs GCP access)", 0
    if provider_type == ProviderType.BEDROCK_CONVERSE:
        missing = [k for k in ("access_key", "secret_key", "region") if not creds.get(k)]
        if missing:
            return False, f"missing fields: {', '.join(missing)}", 0
        start = time.monotonic()
        try:
            import boto3

            client = boto3.client(
                "bedrock",
                aws_access_key_id=creds["access_key"],
                aws_secret_access_key=creds["secret_key"],
                region_name=creds["region"],
            )
            client.list_foundation_models()
            return True, "credentials valid", (time.monotonic() - start) * 1000
        except Exception as e:
            logger.exception("bedrock validation failed")
            return False, f"bedrock rejected credentials: {e}", (time.monotonic() - start) * 1000
    if provider_type == ProviderType.CUSTOM:
        if not creds.get("base_url"):
            return False, "base_url is required", 0
        headers = {"Authorization": f"Bearer {creds['api_key']}"} if creds.get("api_key") else {}
        return _get(f"{creds['base_url'].rstrip('/')}/models", headers=headers)
    return False, f"unknown provider type {provider_type}", 0
