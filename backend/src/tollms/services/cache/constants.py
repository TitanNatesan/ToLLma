"""Centralized TTL registry (seconds). Valkey is a performance layer only —
every entry must be rebuildable from PostgreSQL."""

# Provider validation result (avoids repeat credential probes).
VALIDATION = 300

# Provider discovery result (avoids repeat model listing + mapping).
DISCOVERY = 900

# Conversation usage totals.
CONVERSATION = 300

# Analytics aggregations: short TTL — dashboard freshness matters more than
# cache hit rate, and every payload is rebuildable from PostgreSQL.
ANALYTICS = 60

# Full-text search results (short: new messages must appear quickly).
SEARCH = 30

# Public share lookups (revocation/expiry must take effect fast).
SHARE = 60

# Export job status/metadata.
EXPORT = 300

# Repository search results (user-typed lookups).
REPOSITORY_SEARCH = 3600

# Repository model intelligence (canonical matches, pricing, capabilities).
REPOSITORY_MODEL = 86400

# Distributed locks (short; refreshed only by holder paths that need longer).
# Repo sync TTL comfortably exceeds a live run (~1-2 min) but recovers from
# killed workers without an hour-long manual-sync blackout.
LOCK_REPO_SYNC = 600
LOCK_PROVIDER_REFRESH = 120
LOCK_SCHEDULER = 300
