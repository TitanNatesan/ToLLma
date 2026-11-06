# SBOM — approach (Syft / CycloneDX, free)

## Tool

`anchore/sbom-action` (Syft) — free, no SaaS account, emits CycloneDX JSON
(+ SPDX on request). Chosen over hand-rolled `cyclonedx` CLI because Syft
covers containers and filesystems in one step and is the input the
osv-scanner/trivy jobs already understand.

## Scope (per release, not per PR — avoids artifact churn)

1. Backend image/filesystem.
2. Frontend image/filesystem.
3. Lockfiles: `backend/uv.lock` + `frontend/package-lock.json`.

## Storage

Commit per release tag as `docs/opensource/sbom-backend-<tag>.cdx.json` and
`sbom-frontend-<tag>.cdx.json`, and upload the same files as workflow
artifacts on the release run. PRs do not commit SBOMs.

## Consumption

SBOMs feed the `osv` and `trivy` jobs (vulnerability correlation) and the
release checklist (advisory sweep). No separate SBOM gate — a stale SBOM is
a checklist failure, not a CI failure.

## Suggested release-job snippet (orchestrator to wire in Wave 3)

```yaml
- uses: anchore/sbom-action@v0
  with:
    path: ./
    format: cyclonedx-json
    output-file: sbom-backend-${{ github.ref_name }}.cdx.json
```

Requires production (non-dev) Dockerfiles to be meaningful for image SBOMs;
filesystem/lockfile SBOMs are valid today.
