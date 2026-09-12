# Docker Rules

All services must run through docker-compose and use docker desktop.

---

Always use Docker Desktop (the default docker context).

Never override DOCKER_HOST to point at another daemon
(e.g. the native dockerd socket).

Never run a second copy of the stack on another daemon:
duplicate stacks fight over host ports (5432/8000/3000)
and diverge (separate images, volumes, databases).

If a port is already in use, find and stop the overlapping
container/stack first — never remap host ports to dodge it.

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