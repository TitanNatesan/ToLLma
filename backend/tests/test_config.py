"""Unit tests for application configuration and required environment variables."""

import pytest

from tollms.core.config import ConfigurationError, Settings


def test_settings_success_with_valid_values() -> None:
    settings = Settings(
        secret_key="test-secret-key-12345",
        jwt_secret="test-jwt-secret-67890",
        postgres_db="test_db",
        postgres_user="test_user",
        postgres_password="test_password",
        postgres_host="localhost",
        postgres_port=5432,
    )
    assert settings.postgres_db == "test_db"
    assert settings.postgres_user == "test_user"
    assert settings.secret_key == "test-secret-key-12345"
    assert settings.database_url == "postgresql+psycopg://test_user:test_password@localhost:5432/test_db"
    assert "http://localhost:3000" in settings.cors_origins


def test_settings_missing_required_variables_throws_proper_error(monkeypatch: pytest.MonkeyPatch) -> None:
    # Clear any environment variables that might be present in the testing environment
    for key in [
        "SECRET_KEY",
        "JWT_SECRET",
        "POSTGRES_DB",
        "POSTGRES_USER",
        "POSTGRES_PASSWORD",
        "POSTGRES_HOST",
        "POSTGRES_PORT",
    ]:
        monkeypatch.delenv(key, raising=False)

    # Instantiate Settings pointing to a non-existent env file to simulate missing environment
    with pytest.raises(ConfigurationError) as exc_info:
        Settings(_env_file=".nonexistent")

    error_msg = str(exc_info.value)
    assert "APPLICATION CONFIGURATION ERROR" in error_msg
    assert "Missing required environment variable(s):" in error_msg
    assert "POSTGRES_DB" in error_msg
    assert "POSTGRES_USER" in error_msg
    assert "POSTGRES_PASSWORD" in error_msg
    assert "POSTGRES_HOST" in error_msg
    assert "POSTGRES_PORT" in error_msg
    assert "SECRET_KEY" in error_msg
    assert "JWT_SECRET" in error_msg
    assert ".env.example" in error_msg
