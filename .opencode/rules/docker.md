# Docker Rules

All services must run through docker-compose.

---

Never hardcode:

localhost

inside containers.

Use service names.

---

Container-to-container calls use service names via env
(e.g. BACKEND_URL=http://backend:8000 for SSR/server components).

Browser-facing values legitimately use localhost
(NEXT_PUBLIC_API_URL, BACKEND_CORS_ORIGINS) because the browser
runs outside compose and reaches services via host-mapped ports.

Healthchecks run inside their own container, so localhost there is fine.

---

All configuration must come from .env.

No secrets in source code.