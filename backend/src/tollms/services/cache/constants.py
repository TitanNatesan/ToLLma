"""Centralized TTL registry (seconds). Valkey is a performance layer only —
every entry must be rebuildable from PostgreSQL."""

# Provider validation result (avoids repeat credential probes).
VALIDATION = 300

# Provider discovery result (avoids repeat model listing + mapping).
DISCOVERY = 900

# Conversation usage totals.
CONVERSATION = 300

# Repository search results (user-typed lookups).
REPOSITORY_SEARCH = 3600

# Repository model intelligence (canonical matches, pricing, capabilities).
REPOSITORY_MODEL = 86400

# Distributed locks (short; refreshed only by holder paths that need longer).
LOCK_REPO_SYNC = 3600
LOCK_PROVIDER_REFRESH = 120
LOCK_SCHEDULER = 300
