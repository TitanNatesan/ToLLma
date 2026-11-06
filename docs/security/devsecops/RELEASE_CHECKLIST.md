# Release Security Checklist

Copy per release; all boxes required before tagging.

- [ ] `trust-security.yml` green on the release SHA (all blocking gates pass, SARIF uploaded).
- [ ] License inventory regenerated (`generate-third-party-notices.sh`); no blocklist entries; diff reviewed.
- [ ] SBOMs regenerated (`sbom-backend-<tag>.cdx.json`, `sbom-frontend-<tag>.cdx.json`) and attached to release artifacts.
- [ ] Secrets audit: `git ls-files | grep -x .env` empty; `SECRET_KEY`/`JWT_SECRET` rotated, ≥32 random chars; OAuth/SMTP creds production-scoped (never the `.env.example` dummy `local-dev-secret-key-change-in-prod-32chars!!`).
- [ ] Env: `ENVIRONMENT≠local`, `DEBUG=false`, `BACKEND_CORS_ORIGINS` = production domain(s) only, `TRUSTED_PROXIES` set for proxy IPs.
- [ ] Migrations: single head, `alembic check` green, downgrade tested.
- [ ] Backup taken pre-deploy (see BACKUP_RESTORE.md).
- [ ] Advisory sweep: osv-scanner clean on release lockfiles; outstanding MEDIUMs triaged with owner + date.
- [ ] Security-support wording reconciled (see SECURITY_RECONCILIATION.md — orchestrator decision recorded).
