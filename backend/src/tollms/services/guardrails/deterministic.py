"""Deterministic guardrail detectors: regexes + heuristics, no I/O.

Pure functions so pre/post hooks stay cheap. Every finding is a dict with
category, severity, confidence and a redacted reason excerpt (never the raw
matched secret — only its kind + tail length).
"""

import json
import logging
import re
from typing import Any

logger = logging.getLogger(__name__)

MAX_FINDINGS = 8

_SECRET_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("api-key-prefix", re.compile(r"sk-[A-Za-z0-9_-]{8,}")),
    ("github-token", re.compile(r"gh[pousr]_[A-Za-z0-9]{8,}")),
    ("aws-access-key", re.compile(r"AKIA[0-9A-Z]{16}")),
    ("aws-secret", re.compile(r"(?i)aws_secret[^A-Za-z0-9]{0,10}[A-Za-z0-9/+=]{20,}")),
    ("api-key-assignment", re.compile(r"(?i)(?:api[_-]?key|x-api-key)\s*[:=]\s*['\"]?[^\s'\";,]{8,}")),
    ("bearer-token", re.compile(r"(?i)bearer\s+[A-Za-z0-9\-._~+/=]{8,}")),
    ("private-key", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----")),
    ("jwt", re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}")),
]

_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_PHONE_RE = re.compile(r"(?<!\d)(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}(?!\d)")
_SSN_RE = re.compile(r"(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)")

_INJECTION_RES = [
    re.compile(r"(?i)ignore\s+(all\s+)?(previous|prior|above)\s+instructions"),
    re.compile(r"(?i)system\s+prompt"),
    re.compile(r"(?i)jailbreak|DAN\s+mode|do anything now"),
    re.compile(r"(?i)reveal\s+(your|the)\s+(system\s+)?(prompt|instructions)"),
    re.compile(r"(?i)override\s+(safety|policy|guardrail)"),
    re.compile(r"(?i)pretend\s+(you are|to be)\s+(not|unfiltered|without)"),
]

_TOOL_RISK_RES = [
    re.compile(r"(?i)\b(delete|drop|truncate|rm\s+-rf|format)\b"),
    re.compile(r"(?i)\b(exfiltrate|send\s+to\s+external|POST\s+to)\b"),
    re.compile(r"(?i)\b(sudo|chmod\s+777|disable\s+(auth|firewall))\b"),
]

_UNSAFE_OUTPUT_RES = [
    re.compile(r"(?i)\b(here is|step-by-step).{0,40}(bomb|weapon|malware|ransomware)\b"),
    re.compile(r"(?i)\b(credit\s+card\s+number|ssn|social\s+security)\s*[:#]?\s*\d"),
]


def _finding(category: str, severity: str, confidence: float, reason: str) -> dict[str, Any]:
    return {"category": category, "severity": severity, "confidence": confidence,
            "reason": reason[:500]}


def scan_secrets(text: str) -> list[dict[str, Any]]:
    """Secret-shaped substrings. The reason names the kind only — no values."""
    out: list[dict[str, Any]] = []
    for kind, pattern in _SECRET_PATTERNS:
        try:
            if pattern.search(text or ""):
                out.append(_finding("secret_leakage", "high", 0.9,
                                    f"secret pattern detected: {kind}"))
        except Exception:
            logger.warning("secret scan pattern failed: %s", kind, exc_info=True)
    return out[:MAX_FINDINGS]


def scan_pii(text: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    try:
        if _EMAIL_RE.search(text or ""):
            out.append(_finding("pii", "medium", 0.7, "email address detected"))
        if _PHONE_RE.search(text or ""):
            out.append(_finding("pii", "medium", 0.7, "phone number detected"))
        if _SSN_RE.search(text or ""):
            out.append(_finding("pii", "high", 0.85, "SSN-shaped number detected"))
    except Exception:
        logger.warning("pii scan failed", exc_info=True)
    return out


def scan_prompt_injection(text: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for pattern in _INJECTION_RES:
        try:
            if pattern.search(text or ""):
                out.append(_finding("prompt_injection", "high", 0.8,
                                    "prompt-injection heuristic matched"))
                break
        except Exception:
            logger.warning("injection scan failed", exc_info=True)
    return out


def scan_tool_action(text: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for pattern in _TOOL_RISK_RES:
        try:
            if pattern.search(text or ""):
                out.append(_finding("tool_action", "medium", 0.6,
                                    "risky tool-action keyword matched"))
                break
        except Exception:
            logger.warning("tool-action scan failed", exc_info=True)
    return out


def scan_unsafe_output(text: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for pattern in _UNSAFE_OUTPUT_RES:
        try:
            if pattern.search(text or ""):
                out.append(_finding("unsafe_output", "high", 0.75,
                                    "unsafe-output heuristic matched"))
                break
        except Exception:
            logger.warning("unsafe-output scan failed", exc_info=True)
    return out


def scan_text(text: str) -> list[dict[str, Any]]:
    """All deterministic detectors over one text blob."""
    findings: list[dict[str, Any]] = []
    for scanner in (scan_secrets, scan_pii, scan_prompt_injection,
                    scan_tool_action, scan_unsafe_output):
        findings.extend(scanner(text))
        if len(findings) >= MAX_FINDINGS:
            break
    return findings[:MAX_FINDINGS]


def validate_structure(payload: Any, schema: dict[str, Any] | None) -> list[dict[str, Any]]:
    """JSON-schema check for structured-validation policies.

    Prefers the `jsonschema` package when installed; otherwise enforces a
    minimal required-keys + types subset. Never raises — violations are
    findings, engine errors are warnings.
    """
    if not schema:
        return []
    try:
        try:
            import jsonschema  # type: ignore[import-not-found]

            jsonschema.validate(instance=payload, schema=schema)
            return []
        except ImportError:
            pass
        # Minimal fallback: required keys + primitive type names.
        if not isinstance(payload, dict):
            return [_finding("invalid_structure", "medium", 0.9,
                             "expected a JSON object")]
        for key in schema.get("required", []) or []:
            if key not in payload:
                return [_finding("invalid_structure", "medium", 0.9,
                                 f"missing required key: {key}")]
        props = schema.get("properties", {}) or {}
        for key, spec in props.items():
            if key not in payload or not isinstance(spec, dict):
                continue
            want = spec.get("type")
            got = payload[key]
            ok = {"string": isinstance(got, str), "number": isinstance(got, (int, float)),
                  "integer": isinstance(got, int), "boolean": isinstance(got, bool),
                  "object": isinstance(got, dict), "array": isinstance(got, list)}.get(want, True)
            if not ok:
                return [_finding("invalid_structure", "medium", 0.9,
                                 f"key {key!r} is not {want}")]
        return []
    except Exception as exc:
        logger.warning("structure validation failed", exc_info=True)
        message = str(exc)
        if "is a required property" in message or "Failed validating" in message:
            short = message.splitlines()[0][:200]
            return [_finding("invalid_structure", "medium", 0.9, short)]
        return [_finding("invalid_structure", "low", 0.4, "structure check error")]


def parse_json_payload(text: str) -> tuple[Any | None, bool]:
    """Best-effort JSON parse for structured-validation on raw output text."""
    try:
        return json.loads(text), True
    except (ValueError, TypeError):
        return None, False


def redact_text(s: str | None) -> str:
    """Scrub secret-looking substrings from an untrusted reason string.

    Reuses the scan_secrets patterns (external/model text may echo a key,
    token or private key); matches become [redacted-secret]. Deterministic
    kind-only reasons contain no secret shapes, so redaction is a no-op for
    them. Always truncates to 500 chars for trigger/log/message budgets.
    """
    if not s:
        return ""
    out = str(s)
    for _kind, pattern in _SECRET_PATTERNS:
        try:
            out = pattern.sub("[redacted-secret]", out)
        except Exception:
            logger.warning("reason redaction failed: %s", _kind, exc_info=True)
    return out[:500]
