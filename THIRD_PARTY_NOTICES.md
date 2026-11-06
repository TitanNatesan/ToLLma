# Third-Party Notices — ToLLma

Generated 2026-11-06 by `docs/opensource/generate-third-party-notices.sh`
(Method B: lockfile parse — see `docs/opensource/INVENTORY.md`).
Sources: `backend/uv.lock`, `backend/pyproject.toml`,
`frontend/package.json`, `frontend/package-lock.json`.
Every version below was parsed from those files; none were hand-written.
License texts for non-permissive entries are produced by the CI license job;
this file records the inventory. License policy: `docs/opensource/LICENSE_POLICY.md`.
This file supplements NOTICE (Apache-2.0 attribution header lives there).

## Backend (Python, from `backend/uv.lock`)

| Package | Version | License note |
|---|---|---|
| alembic==1.20.0 | 1.20.0 | direct; confirm via `pip-licenses` (INVENTORY.md) |
| annotated-doc==0.0.5 | 0.0.5 | transitive; confirm via `pip-licenses` (INVENTORY.md) |
| annotated-types==0.8.0 | 0.8.0 | transitive; confirm via `pip-licenses` (INVENTORY.md) |
| anyio==4.15.1 | 4.15.1 | transitive; confirm via `pip-licenses` (INVENTORY.md) |
| apscheduler==3.11.3 | 3.11.3 | direct; confirm via `pip-licenses` (INVENTORY.md) |
| argon2-cffi==25.1.0 | 25.1.0 | direct; confirm via `pip-licenses` (INVENTORY.md) |
| argon2-cffi-bindings==26.1.0 | 26.1.0 | transitive; confirm via `pip-licenses` (INVENTORY.md) |
| boto3==1.43.93 | 1.43.93 | direct; confirm via `pip-licenses` (INVENTORY.md) |
| botocore==1.43.93 | 1.43.93 | transitive; confirm via `pip-licenses` (INVENTORY.md) |
| certifi==2026.7.22 | 2026.7.22 | transitive; confirm via `pip-licenses` (INVENTORY.md) |
| cffi==2.1.1 | 2.1.1 | transitive; confirm via `pip-licenses` (INVENTORY.md) |
| click==8.5.0 | 8.5.0 | transitive; confirm via `pip-licenses` (INVENTORY.md) |
| colorama==0.4.6 | 0.4.6 | transitive; confirm via `pip-licenses` (INVENTORY.md) |
| cryptography==50.0.1 | 50.0.1 | direct; confirm via `pip-licenses` (INVENTORY.md) |
| defusedxml==0.7.1 | 0.7.1 | transitive; confirm via `pip-licenses` (INVENTORY.md) |
| dnspython==2.8.0 | 2.8.0 | transitive; confirm via `pip-licenses` (INVENTORY.md) |
| email-validator==2.3.0 | 2.3.0 | direct; confirm via `pip-licenses` (INVENTORY.md) |
| et-xmlfile==2.0.0 | 2.0.0 | transitive; confirm via `pip-licenses` (INVENTORY.md) |
| fakeredis==2.38.0 | 2.38.0 | direct; confirm via `pip-licenses` (INVENTORY.md) |
| fastapi==0.141.1 | 0.141.1 | direct; attributed in NOTICE |
| fonttools==4.65.0 | 4.65.0 | transitive; confirm via `pip-licenses` (INVENTORY.md) |
| fpdf2==2.8.8 | 2.8.8 | direct; confirm via `pip-licenses` (INVENTORY.md) |
| google-auth==2.58.0 | 2.58.0 | direct; confirm via `pip-licenses` (INVENTORY.md) |
| greenlet==3.5.5 | 3.5.5 | transitive; confirm via `pip-licenses` (INVENTORY.md) |
| h11==0.16.0 | 0.16.0 | transitive; confirm via `pip-licenses` (INVENTORY.md) |
| httpcore==1.0.9 | 1.0.9 | transitive; confirm via `pip-licenses` (INVENTORY.md) |
| httptools==0.8.0 | 0.8.0 | transitive; confirm via `pip-licenses` (INVENTORY.md) |
| httpx==0.28.1 | 0.28.1 | direct; confirm via `pip-licenses` (INVENTORY.md) |
| idna==3.19 | 3.19 | transitive; confirm via `pip-licenses` (INVENTORY.md) |
| iniconfig==2.3.0 | 2.3.0 | transitive; confirm via `pip-licenses` (INVENTORY.md) |
| jmespath==1.1.0 | 1.1.0 | transitive; confirm via `pip-licenses` (INVENTORY.md) |
| mako==1.4.1 | 1.4.1 | transitive; confirm via `pip-licenses` (INVENTORY.md) |
| markupsafe==3.0.3 | 3.0.3 | transitive; confirm via `pip-licenses` (INVENTORY.md) |
| openpyxl==3.1.5 | 3.1.5 | direct; confirm via `pip-licenses` (INVENTORY.md) |
| packaging==26.3 | 26.3 | transitive; confirm via `pip-licenses` (INVENTORY.md) |
| pillow==12.3.0 | 12.3.0 | direct; confirm via `pip-licenses` (INVENTORY.md) |
| pluggy==1.6.0 | 1.6.0 | transitive; confirm via `pip-licenses` (INVENTORY.md) |
| psutil==7.2.2 | 7.2.2 | direct; confirm via `pip-licenses` (INVENTORY.md) |
| psycopg==3.3.5 | 3.3.5 | direct; attributed in NOTICE |
| psycopg-binary==3.3.5 | 3.3.5 | transitive; LGPL-3.0 per upstream (review-list, allowed with attribution) |
| pyasn1==0.6.4 | 0.6.4 | transitive; confirm via `pip-licenses` (INVENTORY.md) |
| pyasn1-modules==0.4.2 | 0.4.2 | transitive; confirm via `pip-licenses` (INVENTORY.md) |
| pycparser==3.0 | 3.0 | transitive; confirm via `pip-licenses` (INVENTORY.md) |
| pydantic==2.13.5 | 2.13.5 | direct; attributed in NOTICE |
| pydantic-core==2.46.5 | 2.46.5 | transitive; confirm via `pip-licenses` (INVENTORY.md) |
| pydantic-settings==2.15.0 | 2.15.0 | direct; attributed in NOTICE |
| pygments==2.21.0 | 2.21.0 | transitive; confirm via `pip-licenses` (INVENTORY.md) |
| pyjwt==2.14.0 | 2.14.0 | direct; confirm via `pip-licenses` (INVENTORY.md) |
| pypdf==6.18.1 | 6.18.1 | direct; confirm via `pip-licenses` (INVENTORY.md) |
| pytest==9.1.1 | 9.1.1 | direct; confirm via `pip-licenses` (INVENTORY.md) |
| python-dateutil==2.9.0.post0 | 2.9.0.post0 | transitive; confirm via `pip-licenses` (INVENTORY.md) |
| python-dotenv==1.2.3 | 1.2.3 | transitive; confirm via `pip-licenses` (INVENTORY.md) |
| python-multipart==0.0.32 | 0.0.32 | direct; confirm via `pip-licenses` (INVENTORY.md) |
| pyyaml==6.0.3 | 6.0.3 | transitive; confirm via `pip-licenses` (INVENTORY.md) |
| redis==8.1.0 | 8.1.0 | direct; attributed in NOTICE |
| s3transfer==0.19.2 | 0.19.2 | transitive; confirm via `pip-licenses` (INVENTORY.md) |
| six==1.17.0 | 1.17.0 | transitive; confirm via `pip-licenses` (INVENTORY.md) |
| sortedcontainers==2.4.0 | 2.4.0 | transitive; confirm via `pip-licenses` (INVENTORY.md) |
| sqlalchemy==2.0.52 | 2.0.52 | direct; attributed in NOTICE |
| starlette==1.6.0 | 1.6.0 | transitive; confirm via `pip-licenses` (INVENTORY.md) |
| tollms==0.1.0 | 0.1.0 | transitive; confirm via `pip-licenses` (INVENTORY.md) |
| typing-extensions==4.16.0 | 4.16.0 | transitive; confirm via `pip-licenses` (INVENTORY.md) |
| typing-inspection==0.4.4 | 0.4.4 | transitive; confirm via `pip-licenses` (INVENTORY.md) |
| tzdata==2026.4 | 2026.4 | transitive; confirm via `pip-licenses` (INVENTORY.md) |
| tzlocal==5.4.4 | 5.4.4 | transitive; confirm via `pip-licenses` (INVENTORY.md) |
| urllib3==2.7.0 | 2.7.0 | transitive; confirm via `pip-licenses` (INVENTORY.md) |
| uvicorn==0.52.4 | 0.52.4 | direct; confirm via `pip-licenses` (INVENTORY.md) |
| uvloop==0.22.1 | 0.22.1 | transitive; confirm via `pip-licenses` (INVENTORY.md) |
| watchfiles==1.2.0 | 1.2.0 | transitive; confirm via `pip-licenses` (INVENTORY.md) |
| websockets==17.1 | 17.1 | transitive; confirm via `pip-licenses` (INVENTORY.md) |

## Frontend (JavaScript/TypeScript, from `frontend/package-lock.json`)

| Package | Version | License (lockfile field) | Scope |
|---|---|---|---|
| @playwright/test==1.63.0 | 1.63.0 | Apache-2.0 | devDependencies |
| @radix-ui/react-collapsible==1.1.20 | 1.1.20 | MIT | dependencies |
| @radix-ui/react-dialog==1.1.23 | 1.1.23 | MIT | dependencies |
| @radix-ui/react-dropdown-menu==2.1.24 | 2.1.24 | MIT | dependencies |
| @radix-ui/react-hover-card==1.1.23 | 1.1.23 | MIT | dependencies |
| @radix-ui/react-popover==1.1.23 | 1.1.23 | MIT | dependencies |
| @radix-ui/react-scroll-area==1.2.18 | 1.2.18 | MIT | dependencies |
| @radix-ui/react-separator==1.1.15 | 1.1.15 | MIT | dependencies |
| @radix-ui/react-slot==1.3.3 | 1.3.3 | MIT | dependencies |
| @radix-ui/react-switch==1.3.7 | 1.3.7 | MIT | dependencies |
| @radix-ui/react-tooltip==1.2.16 | 1.2.16 | MIT | dependencies |
| @radix-ui/react-use-controllable-state==1.2.6 | 1.2.6 | MIT | dependencies |
| @tailwindcss/postcss==4.3.3 | 4.3.3 | MIT | devDependencies |
| @tanstack/react-query==5.102.8 | 5.102.8 | MIT | dependencies |
| @types/node==22.20.2 | 22.20.2 | MIT | devDependencies |
| @types/react==19.3.0 | 19.3.0 | MIT | devDependencies |
| @types/react-dom==19.3.0 | 19.3.0 | MIT | devDependencies |
| ai-elements==1.9.0 | 1.9.0 | Apache-2.0 | devDependencies |
| babel-plugin-react-compiler==1.0.0 | 1.0.0 | MIT | devDependencies |
| class-variance-authority==0.7.1 | 0.7.1 | Apache-2.0 | dependencies |
| clsx==2.1.1 | 2.1.1 | MIT | dependencies |
| cmdk==1.1.1 | 1.1.1 | MIT | dependencies |
| eslint==9.39.5 | 9.39.5 | MIT | devDependencies |
| eslint-config-next==16.3.5 | 16.3.5 | MIT | devDependencies |
| framer-motion==12.43.0 | 12.43.0 | MIT | dependencies |
| katex==0.19.0 | 0.19.0 | MIT | dependencies |
| lucide-react==1.45.0 | 1.45.0 | ISC | dependencies |
| mermaid==12.0.0 | 12.0.0 | MIT | dependencies |
| next==16.3.5 | 16.3.5 | MIT | dependencies |
| react==19.2.8 | 19.2.8 | MIT | dependencies |
| react-dom==19.2.8 | 19.2.8 | MIT | dependencies |
| react-markdown==10.1.0 | 10.1.0 | MIT | dependencies |
| recharts==3.10.1 | 3.10.1 | MIT | dependencies |
| rehype-highlight==7.0.2 | 7.0.2 | MIT | dependencies |
| rehype-katex==7.0.1 | 7.0.1 | MIT | dependencies |
| remark-gfm==4.0.1 | 4.0.1 | MIT | dependencies |
| remark-math==6.0.0 | 6.0.0 | MIT | dependencies |
| sileo==0.1.6 | 0.1.6 | MIT | dependencies |
| tailwind-merge==3.7.0 | 3.7.0 | MIT | dependencies |
| tailwindcss==4.3.3 | 4.3.3 | MIT | devDependencies |
| typescript==5.9.3 | 5.9.3 | Apache-2.0 | devDependencies |
| use-stick-to-bottom==1.1.6 | 1.1.6 | MIT | dependencies |
| vitest==5.0.0 | 5.0.0 | MIT | devDependencies |
| zustand==5.0.15 | 5.0.15 | MIT | dependencies |

Transitive frontend dependencies (hundreds) are not enumerated here; the full
closure is produced per-release by `license-checker` (see INVENTORY.md).

