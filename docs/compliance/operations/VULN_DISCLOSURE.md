# Vulnerability Disclosure Process

- Intake is public and rate-limited; reporter contact is admin-only PII and
  never echoed back (`IntakeAccepted` carries id + status only).
- Triage grades severity (default `medium`) and moves
  `received → triaged → confirmed → fixed → disclosed → closed`
  (`dismissed → closed` for invalid/duplicates, always with a reason).
- Coordinated disclosure: `fixed` stamps `fixed_at`; public disclosure
  stamps `coordinated_disclosure_at`. No silent pushes — the reporter is
  notified at `confirmed` and at `disclosed`.
- Link the platform incident for SEV1/SEV2 (`link_incident_id`); the incident
  timeline is the cross-case record.
- Reporter identity is never published; advisories credit anonymous or
  opted-in handles only.
