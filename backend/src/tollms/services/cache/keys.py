"""Central key registry. No hardcoded cache keys anywhere else.

Layout: ``tollma:<section>:<identifier>``. Sections double as
invalidation scopes (``tollma:<section>:*``).
"""

import hashlib

PREFIX = "tollma"


def _key(section: str, identifier: str) -> str:
    return f"{PREFIX}:{section}:{identifier}"


def section_pattern(section: str) -> str:
    return f"{PREFIX}:{section}:*"


# --- providers -------------------------------------------------------------
def provider(provider_id: object) -> str:
    return _key("provider", str(provider_id))


def provider_models(provider_id: object) -> str:
    return _key("provider_models", str(provider_id))


def provider_validation(provider_id: object) -> str:
    return _key("provider_validation", str(provider_id))


def provider_refresh_lock(provider_id: object) -> str:
    return _key("lock", f"provider_refresh:{provider_id}")


# --- registered models / gateway metadata ----------------------------------
def model(model_id: object) -> str:
    return _key("model", str(model_id))


def repository_model(repo_key: str) -> str:
    return _key("repository", f"model:{repo_key}")


def repository_match(provider_type: str | None, model_id: str) -> str:
    return _key("repository", f"match:{(provider_type or 'any').lower()}:{model_id}")


def repository_search(query: str, provider_hint: str | None = None) -> str:
    digest = hashlib.sha1(f"{(provider_hint or '').lower()}|{query.strip().lower()}".encode()).hexdigest()[:16]
    return _key("repository", f"search:{digest}")


# --- conversations ---------------------------------------------------------
def conversation(conversation_id: object) -> str:
    return _key("conversation", str(conversation_id))


def conversation_messages(conversation_id: object) -> str:
    return _key("conversation", f"messages:{conversation_id}")


def usage_totals(conversation_id: object, user_id: object | None = None) -> str:
    scope = str(user_id) if user_id is not None else "legacy"
    return _key("conversation", f"usage:{scope}:{conversation_id}")


# --- generations (active-state cache; DB rows are permanent storage) --------
def generation(generation_id: object) -> str:
    return _key("generation", str(generation_id))


def generation_by_conversation(conversation_id: object) -> str:
    return _key("generation", f"conv:{conversation_id}")


# --- auth sessions -------------------------------------------------------
def session(session_id: str) -> str:
    return _key("session", session_id)


def user_sessions(user_id: object) -> str:
    """Valkey SET of live session ids for one user (enables listing/revocation)."""
    return _key("sessions", str(user_id))


def verify_email(token_hash: str) -> str:
    return _key("verify_email", token_hash)


def oauth_state(state: str) -> str:
    return _key("oauth_state", state)


# --- auth abuse protection (fixed-window counters, no PII in keys) -----------
def auth_rate_limit(scope: str, identifier: str) -> str:
    safe = "".join(c if c.isalnum() or c in "-_:. " else "_" for c in identifier).strip()
    return _key("ratelimit", f"{scope}:{safe or 'unknown'}")


def login_attempts(digest: str) -> str:
    """Failed-login counter keyed by sha256(email|ip) — the email never lands in Valkey."""
    return _key("login_attempts", digest)


# --- analytics --------------------------------------------------------------
def analytics(user_id: object, digest: str) -> str:
    """One aggregated analytics payload (digest covers range/granularity/sort)."""
    return _key("analytics", f"{user_id}:{digest}")


def analytics_pattern(user_id: object) -> str:
    return _key("analytics", f"{user_id}:*")


# --- conversation intelligence ----------------------------------------------
def search_results(user_id: object, digest: str) -> str:
    return _key("search", f"{user_id}:{digest}")


def search_pattern(user_id: object) -> str:
    return _key("search", f"{user_id}:*")


def share_lookup(token: str) -> str:
    return _key("share", token)



# --- api keys ---------------------------------------------------------------

def key_tombstone(key_hash: str) -> str:
    """Revocation marker for a deleted/rotated key hash (``{"revoked_at": ts}``).

    Checked before the compiled-context cache so a dead hash can never be
    resurrected by a stale context entry.
    """
    return _key("keytomb", key_hash)


# --- future SaaS surface (reserved; no writers yet) ------------------------
def gateway_response(request_hash: str) -> str:
    return _key("gateway", f"response:{request_hash}")


def provider_usage(provider_id: object) -> str:
    return _key("usage", str(provider_id))


def budget(organization_id: object) -> str:
    return _key("budget", str(organization_id))


def virtual_key(key_id: object) -> str:
    return _key("virtual_key", str(key_id))


def organization_settings(organization_id: object) -> str:
    return _key("org", f"settings:{organization_id}")


# --- observability (best-effort Valkey counters; metrics only, fail-open) ---
def metrics_counter(name: str, labels: dict[str, str] | None = None) -> str:
    """Counter key: ``tollma:metrics:<name>[:k=v...]`` (labels sorted)."""
    suffix = ""
    if labels:
        suffix = ":" + ",".join(f"{k}={v}" for k, v in sorted(labels.items()))
    return _key("metrics", f"{name}{suffix}")


# --- distributed locks -----------------------------------------------------
LOCK_REPO_SYNC = _key("lock", "model_repo_sync")
LOCK_SCHEDULER = _key("lock", "model_repo_scheduler")
