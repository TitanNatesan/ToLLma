FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HUB_CACHE=/app/.cache/huggingface \
    HF_HUB_OFFLINE=0

WORKDIR /app
COPY requirements.txt ./
# CPU-only torch first (PyPI wheels bundle CUDA); then the pinned stack.
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r requirements.txt \
    && useradd -m -s /usr/sbin/nologin laya \
    && mkdir -p /app/.cache && chown -R laya:laya /app
COPY --chown=laya:laya app.py config.py questions.py engine.py mapping.py MODEL_VERSION README.md ./
USER laya

EXPOSE 8001
# Checkpoint downloads on first start into HF_HUB_CACHE; to persist across
# restarts, mount a named volume at /app/.cache (documents the requirement —
# root docker-compose.yml is intentionally untouched).
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8001"]
