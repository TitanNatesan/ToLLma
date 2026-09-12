FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/src \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_LINK_MODE=copy \
    PATH="/opt/venv/bin:$PATH"

COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv

WORKDIR /app

# First install dependencies only (cached until pyproject.toml or uv.lock change)
COPY pyproject.toml README.md uv.lock* ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --group dev --no-install-project

# Copy source and install project package
COPY src/ ./src/
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --group dev

COPY alembic.ini ./
COPY alembic/ ./alembic/
COPY tests/ ./tests/

EXPOSE 8000

CMD ["uvicorn", "tollms.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
