# Admin UI Spec — Compliance Operations (Agent E, Wave 3)

Exact contract. F adds no frontend code (ownership: `app/admin/**` new
compliance subroutes only, coordinated — E implements).

## 1. New hash sections (append-only, existing 13 untouched)

Append to `ADMIN_SECTIONS` (order matters, group under a "Compliance" label):

| id | label | icon |
|---|---|---|
| `incidents` | Incidents | `Siren` |
| `abuse-reviews` | Abuse reviews | `ShieldAlert` |
| `legal-requests` | Legal requests | `Scale` |
| `vuln-reports` | Vuln reports | `Bug` |
| `complaints` | Complaints | `MessageSquareWarning` |
| `vendors` | Vendors | `Truck` |

`AdminSectionId` extends automatically (`as const` union). No changes to
existing section ids, `useHashSection` default, or `ForbiddenState` logic —
reuse `ForbiddenState` + `SectionBody`/`SectionSkeleton`/`ErrorState` as-is.

## 2. Data layer (react-query, mirrors existing `useAdminQuery`)

```ts
// query keys — F contract, do not rename without F:
["admin", "incidents", params]       // GET /api/admin/compliance/incidents?status=&severity=&limit=&cursor=
["admin", "legal-requests", params]  // GET /api/admin/compliance/legal-requests?status=&limit=&cursor=
["admin", "vuln-reports", params]    // + severity=
["admin", "complaints", params]      // ?status=&limit=&cursor=
["admin", "abuse-reviews", params]   // GET /api/admin/compliance/abuse-reviews?status=&limit= (D shape, no cursor)
["admin", "vendors", params]         // GET /api/admin/compliance/subprocessors (full admin shape)
```

- List responses: `{items: [{id, title, status, severity?, created_at,
  updated_at}], next_cursor}` with `X-Next-Cursor` header mirror (same as
  prompt-logs). Pager: "Load more" appends via `cursor=next_cursor`.
- Detail: `GET <base>/{id}`. PATCH `{to, note?, link_incident_id?,
  owner_admin_id? (incidents only)}`. Illegal transitions return 422 with the
  `VALIDATION_ERROR` wire body — surface `error.message` verbatim.
- Status filter dropdowns use the exact server enums (incidents:
  `open|triaged|mitigating|resolved|closed|duplicate`; legal:
  `received|verifying|validated|in_review|fulfilled|rejected|closed`; vuln:
  `received|triaged|confirmed|fixed|disclosed|dismissed|closed`; complaints:
  `received|under_review|resolved|dismissed|escalated|closed`). Never
  invent labels — display titles come from a local map E owns.
- Reporter PII (`reporter_contact`, `details`, `verify_notes`) appears on
  detail views only, behind the existing `isAdmin` gate; list views never
  carry it (server guarantee — no client filtering needed).

## 3. Trust Center handoff (read-only)

Public subprocessor feed: `GET /api/v1/subprocessors` → exactly
`[{name, purpose, location, status}]` (active only). No auth needed. Render
as a static table on `/trust`; no admin fields exist in the payload.

## 4. Non-goals for E

No intake forms in admin (intake is public API + Trust Center pages);
no audit-log UI (central log is C/orchestrator Wave 3); no changes to the
13 telemetry sections, `AdminRangePicker`, or sidebar behavior beyond
appending the six anchors.
