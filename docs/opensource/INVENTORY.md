# License Inventory — how to regenerate

Two methods. Method A is authoritative for license *texts*; Method B is the
checked-in inventory and requires only the stdlib.

## Method A (authoritative, runs in CI + on demand)

Backend (ephemeral install — `pip-licenses` is deliberately NOT a project dep):

```bash
pip install pip-licenses
pip install -e ./backend
pip-licenses --format=json --with-license-file --no-license-path
```

Frontend (ephemeral via npx — no `package.json` change):

```bash
cd frontend && npx -y license-checker --json --out /tmp/frontend-licenses.json
```

## Method B (checked-in inventory, no installs)

```bash
bash docs/opensource/generate-third-party-notices.sh          # regenerate root THIRD_PARTY_NOTICES.md
bash docs/opensource/generate-third-party-notices.sh --check  # freshness check (used non-blocking in CI)
```

Parses `backend/uv.lock` (70 packages at last run), `backend/pyproject.toml`
(direct-vs-transitive scope), `frontend/package.json` + `frontend/package-lock.json`
(direct deps with resolved versions + lockfile license fields). Versions are
never hand-written. Backend license cells cite NOTICE where the repo already
attributes the package, else defer to Method A.

## Cadence

Regenerate on every dependency change (same PR) and at release tagging.
CI `--check` warns (non-blocking) on drift; the blocklist gate stays blocking.
