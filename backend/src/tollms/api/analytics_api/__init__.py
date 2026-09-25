"""Analytics API feature package (`/api/analytics`).

Session-authenticated. ``/platform`` is platform-admin only; every
``/api-keys/*`` route is user-scoped (foreign or soft-deleted keys 404).
"""
