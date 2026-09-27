"""Application configuration. All values come from the environment / .env."""

from functools import lru_cache
from typing import Any

from pydantic import ValidationError
from pydantic_settings import BaseSettings, SettingsConfigDict


class ConfigurationError(RuntimeError):
    """Raised when required environment configuration is missing or invalid."""


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    def __init__(self, **values: Any) -> None:
        try:
            super().__init__(**values)
        except ValidationError as exc:
            missing_fields: list[str] = []
            invalid_fields: list[str] = []
            for error in exc.errors():
                loc = error.get("loc", [""])[0]
                field_name = str(loc).upper()
                if error.get("type") == "missing":
                    missing_fields.append(field_name)
                else:
                    msg = error.get("msg", "invalid value")
                    invalid_fields.append(f"{field_name} ({msg})")

            details: list[str] = []
            if missing_fields:
                details.append(
                    "Missing required environment variable(s):\n    "
                    + "\n    ".join(f"- {f}" for f in missing_fields)
                )
            if invalid_fields:
                details.append(
                    "Invalid environment variable(s):\n    "
                    + "\n    ".join(f"- {f}" for f in invalid_fields)
                )

            details_text = "\n\n".join(details)
            raise ConfigurationError(
                f"\n{'=' * 72}\n"
                f"APPLICATION CONFIGURATION ERROR\n"
                f"{'-' * 72}\n"
                f"{details_text}\n\n"
                f"Please ensure all required variables are set in your environment or .env file.\n"
                f"Refer to .env.example for required configuration.\n"
                f"{'=' * 72}"
            ) from None

    # Application metadata
    project_name: str = "ToLLma"
    project_description: str = "Toll to your Large Language Models & Agents"
    environment: str = "local"
    debug: bool = True

    # Server configuration
    backend_host: str = "0.0.0.0"
    backend_port: int = 8000
    api_v1_prefix: str = "/api/v1"

    # Security (Required: must be provided via environment or .env)
    secret_key: str

    # JWT authentication
    jwt_secret: str = ""
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 15
    refresh_token_days: int = 30
    verification_token_hours: int = 24
    # Session hardening (Valkey-only state): absolute lifetime bounds the
    # refresh-rotation chain, idle timeout bounds inactivity, and the per-user
    # cap evicts the oldest session. No migration: all three live in the
    # session record + user_sessions index.
    session_absolute_lifetime_days: int = 90
    session_idle_timeout_hours: int = 8
    session_max_per_user: int = 10
    # Verification-resend per-user cooldown (Valkey fixed-window, fail-closed).
    verification_resend_cooldown_seconds: int = 60

    @property
    def jwt_signing_key(self) -> str:
        return self.jwt_secret or self.secret_key

    # Google OAuth (optional: /auth/google/* returns 503 when unset)
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = ""
    frontend_url: str = "http://localhost:3000"

    # Email (optional: verification links are logged when SMTP is unset)
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from: str = "ToLLma <no-reply@tollma.ai>"
    smtp_use_tls: bool = True
    # Password reset: token lifetime + whether a successful reset kills every
    # live session (preferred: force re-login everywhere).
    password_reset_ttl_minutes: int = 60
    password_reset_invalidate_sessions: bool = True

    # Auth abuse protection (Valkey fixed-window, fail-closed: auth paths deny
    # with 503 when Valkey is unreachable since sessions require it anyway).
    # Generic per-endpoint flood guard (per scope + client IP).
    auth_rate_limit_attempts: int = 60
    auth_rate_limit_window_seconds: int = 60
    # Password-guessing guard (per email + IP, lockout with expiry).
    login_max_attempts: int = 5
    login_lockout_seconds: int = 900

    # CORS
    backend_cors_origins: str = "http://localhost:3000"

    # PostgreSQL (Required: must be provided via environment or .env)
    postgres_db: str
    postgres_user: str
    postgres_password: str
    postgres_host: str
    postgres_port: int

    # Valkey cache (optional: graceful bypass when unreachable/disabled)
    valkey_host: str = "localhost"
    valkey_port: int = 6379
    valkey_password: str = ""
    valkey_db: int = 0
    cache_enabled: bool = True

    # Attachment storage (local filesystem; served only through owned endpoints)
    storage_dir: str = "storage/uploads"
    max_upload_mb: int = 25
    # Orphan sweep: hard-delete staged/empty (zero-message) conversations older
    # than this many days. Messaged rows are never touched.
    orphan_sweep_days: int = 7

    # Logging
    log_level: str = "INFO"

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+psycopg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.backend_cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
