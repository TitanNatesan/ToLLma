FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/src \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH="/opt/venv/bin:$PATH"

COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv

WORKDIR /app

COPY pyproject.toml README.md ./
COPY src/ ./src/
RUN uv sync --group dev

COPY alembic.ini ./
COPY alembic/ ./alembic/
COPY tests/ ./tests/

EXPOSE 8000

CMD ["uvicorn", "tollms.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
