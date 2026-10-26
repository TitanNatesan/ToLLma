"""Prompt logging feature service: thin facade over settings + records.

Routers import this module only (never services.* engines); cohesive logic
lives in settings.py (workspace policy) and records.py (ledger reads/writes).
"""

from tollms.api.prompt_logging.records import (
    delete_log,
    get_log_detail,
    list_logs,
    purge_logs,
    retention_info,
)
from tollms.api.prompt_logging.settings import (
    get_settings,
    list_teams,
    read_setting,
    set_key_state,
    set_team_state,
    upsert_settings,
)

__all__ = [
    "delete_log",
    "get_log_detail",
    "get_settings",
    "list_logs",
    "list_teams",
    "purge_logs",
    "read_setting",
    "retention_info",
    "set_key_state",
    "set_team_state",
    "upsert_settings",
]
