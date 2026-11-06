# Subprocessor Process

- Registry lives in `subprocessors` (name live-unique, purpose, location,
  status, `dpa_ref` admin-only, soft-delete on removal with `removed_at`).
- Public Trust Center shape is exactly F10: `{name, purpose, location,
  status}` for `active` rows only — `dpa_ref`, timestamps, and
  pending/removed rows never leave the admin boundary.
- Change process: add as `pending` → flip to `active` after DPA review
  (`dpa_ref` set) → `removed` (soft-delete row, name reusable) when offboarded.
  Every change writes a security-audit row.
- Agent E renders the public list; Agent F owns the table + admin CRUD.
  REQUIRES_LEGAL_REVIEW for DPA text (Agent A), not for the registry shape.
