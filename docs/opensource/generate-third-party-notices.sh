#!/usr/bin/env bash
# Regenerate the root THIRD_PARTY_NOTICES.md from lockfile metadata.
# Owned by Agent G (docs/opensource/**). Read-only inputs, one write output.
#
#   bash docs/opensource/generate-third-party-notices.sh          # regenerate
#   bash docs/opensource/generate-third-party-notices.sh --check  # CI freshness
#
# Method: stdlib-only parsing (tomllib + json). No network, no new dependencies.
# Versions are NEVER invented — every version string comes from
# backend/uv.lock or frontend/package-lock.json. Frontend license fields come
# from package-lock.json "license" entries. uv.lock carries no license data,
# so backend license cells cite the pre-existing NOTICE attributions where the
# package is named there, and otherwise point at `pip-licenses` (see
# docs/opensource/INVENTORY.md), which is authoritative in CI.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="$ROOT/THIRD_PARTY_NOTICES.md"

python3 - "$ROOT" "$OUT" "${1:-}" <<'EOF'
import json, re, sys, tomllib
from datetime import date
from pathlib import Path

root, out, mode = Path(sys.argv[1]), Path(sys.argv[2]), (sys.argv[3] if len(sys.argv) > 3 else "")

# ---- backend: uv.lock (all packages, name + version, parsed only) ----
uv = tomllib.loads((root / "backend/uv.lock").read_bytes().decode())
be_pkgs = sorted(((p["name"], p["version"]) for p in uv.get("package", [])),
                 key=lambda t: t[0].lower())

# Direct deps from pyproject (names only; versions resolved via uv.lock above).
pyproj = tomllib.loads((root / "backend/pyproject.toml").read_bytes().decode())
direct_reqs = pyproj["project"]["dependencies"]
dev_reqs = pyproj.get("dependency-groups", {}).get("dev", [])
def req_name(r):
    return re.split(r"[<>=!~\s;\[]", r.strip())[0].strip().lower()
direct_names = {req_name(r) for r in direct_reqs} | {req_name(r) for r in dev_reqs}
be_ver = {n.lower(): v for n, v in be_pkgs}

# License hints ONLY from the repo's own pre-existing NOTICE claims (cited, not asserted).
notice = (root / "NOTICE").read_text()
def notice_cites(*needles):
    n = notice.lower()
    return all(x.lower() in n for x in needles)

# ---- frontend: package.json direct deps + package-lock resolved versions/licenses ----
pkg = json.loads((root / "frontend/package.json").read_text())
lock = json.loads((root / "frontend/package-lock.json").read_text())
lock_pkgs = lock.get("packages", {})
fe_rows = []
for scope in ("dependencies", "devDependencies"):
    for name in pkg.get(scope, {}):
        node = lock_pkgs.get(f"node_modules/{name}", {})
        fe_rows.append((name,
                        node.get("version", "UNRESOLVED"),
                        node.get("license", "not declared in lockfile"),
                        scope))
fe_rows.sort(key=lambda r: r[0].lower())

# ---- --check mode: every parsed name==version must appear in committed file ----
if mode == "--check":
    committed = out.read_text() if out.exists() else ""
    missing = [f"{n}=={v}" for n, v in be_pkgs if f"{n}=={v}" not in committed]
    missing += [f"{n}=={v}" for n, v, _, _ in fe_rows
                if v != "UNRESOLVED" and f"{n}=={v}" not in committed]
    if missing:
        print("THIRD_PARTY_NOTICES.md is stale; missing entries:")
        print("\n".join("  " + m for m in missing))
        sys.exit(1)
    print(f"THIRD_PARTY_NOTICES.md is fresh "
          f"({len(be_pkgs)} backend + {len(fe_rows)} frontend entries).")
    sys.exit(0)

# ---- emit ----
L = []
L.append("# Third-Party Notices — ToLLma")
L.append("")
L.append(f"Generated {date.today().isoformat()} by `docs/opensource/generate-third-party-notices.sh`")
L.append("(Method B: lockfile parse — see `docs/opensource/INVENTORY.md`).")
L.append("Sources: `backend/uv.lock`, `backend/pyproject.toml`,")
L.append("`frontend/package.json`, `frontend/package-lock.json`.")
L.append("Every version below was parsed from those files; none were hand-written.")
L.append("License texts for non-permissive entries are produced by the CI license job;")
L.append("this file records the inventory. License policy: `docs/opensource/LICENSE_POLICY.md`.")
L.append("This file supplements NOTICE (Apache-2.0 attribution header lives there).")
L.append("")
L.append("## Backend (Python, from `backend/uv.lock`)")
L.append("")
L.append("| Package | Version | License note |")
L.append("|---|---|---|")
for n, v in be_pkgs:
    scope = "direct" if n.lower() in direct_names else "transitive"
    if notice_cites(n):
        note = f"{scope}; attributed in NOTICE"
    else:
        note = f"{scope}; confirm via `pip-licenses` (INVENTORY.md)"
    if n == "psycopg-binary":
        note = f"{scope}; LGPL-3.0 per upstream (review-list, allowed with attribution)"
    L.append(f"| {n}=={v} | {v} | {note} |")
L.append("")
L.append("## Frontend (JavaScript/TypeScript, from `frontend/package-lock.json`)")
L.append("")
L.append("| Package | Version | License (lockfile field) | Scope |")
L.append("|---|---|---|---|")
for n, v, lic, scope in fe_rows:
    L.append(f"| {n}=={v} | {v} | {lic} | {scope} |")
L.append("")
L.append("Transitive frontend dependencies (hundreds) are not enumerated here; the full")
L.append("closure is produced per-release by `license-checker` (see INVENTORY.md).")
L.append("")
out.write_text("\n".join(L) + "\n")
print(f"Wrote {out} ({len(be_pkgs)} backend, {len(fe_rows)} frontend direct).")
EOF
