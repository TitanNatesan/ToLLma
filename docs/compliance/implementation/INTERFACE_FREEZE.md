# Interface Freeze — Wave 2 binding contracts (2026-11-07, orchestrator)

Reconciled from Wave 1 reports A/B/C/D/E/F/G. Changes require orchestrator approval.

## F1. Legal document identity (A → orchestrator/E)

`{slug: str, version: semver str, content_hash: "sha256:<hex>"}` — hash over
canonical markdown (LF, no front-matter). Lifecycle `draft|published|archived`;
one `published` per slug per locale; MAJOR bumps set `requires_reaccept=true`.
Locales: `en-IN` first; no machine-translated binding text.

## F2. Legal acceptance record (orchestrator implements)

`user_id FK, document_slug, document_version, content_hash, accepted_at
(server-stamped), method enum {signup_checkbox, reaccept_banner, api_explicit,
google_signup_checkbox}, locale, ui_version, ip_trunc (/24 or /48 hash, never
full IP), user_agent_snippet(200)`. Partial unique `(user_id, document_slug,
content_hash)`. Append-only: no UPDATE/DELETE path.

## F3. 18+ eligibility gate (orchestrator implements in auth)

Unchecked-by-default checkbox on password signup + post-OAuth interstitial;
no confirm → 422 `AGE_CONFIRMATION_REQUIRED`. Store `age_confirmed_at TIMESTZ
NULL` + `age_confirm_method='self_declaration'` on users; NULL = legacy,
one-click re-confirm at login via banner. Withhold session until confirmed
(Google path: short-TTL signed pending token, no persistent row).

## F4. Consent categories (B → E, frozen enum)

`functional` (required, non-withdrawable) | `analytics` | `prompt_logging` |
`marketing` (reserved, no writers) | `third_party_sharing` (reserved, needs
DPA text). Lowercase strings. One active grant per (user, category).

## F5. DSR state machine (B implements, F grievance-handoff, E displays)

Types: `access|correction|erasure|portability|grievance`. States: `submitted →
under_review → in_progress → fulfilled | partially_fulfilled | rejected`
(terminal immutable; `rejected` needs reason_code). SLA: `due_at` 30d default.

## F6. Security audit event envelope (C → F, field names frozen)

Table `security_audit`: `event_id PK, occurred_at idx, actor_type enum
{user|api_key|system|anonymous}, actor_user_id?, actor_key_id? (row id, never
secret), actor_org_id?, session_id? (sid prefix-8 only), event_type enum
{auth.login|auth.login_failed|auth.lockout|auth.refresh_reuse|session.revoked|
key.created|key.rotated|key.deleted|provider.credentials_written|
provider.validated|gateway.denied|gateway.overbudget|org.perm_changed|
org.member_removed|egress.blocked|config.security_changed}, severity enum
{info|warn|critical}, outcome enum {allowed|denied|error}, ip_hash?
(sha256+salt, never raw), user_agent_hash?, target_type?, target_id?,
reason? (machine code), request_id?, metadata jsonb (ids/codes only)`.
Paging `(occurred_at desc, event_id desc)`.

## F7. Abuse-report contract (D owns intake+table, F owns review queue)

Status enum (D canonical, F adapts — no `escalated|closed` rename; escalation
is `under_review` + assignee set, closure maps to `dismissed|action_upheld|
action_reversed`): `submitted|under_review|action_taken|dismissed|
appeal_filed|action_upheld|action_reversed`. Reason codes: `harmful_content|
prompt_injection_attempt|secret_or_pii_exposure|policy_violation|
billing_or_quota_abuse|account_compromise|other`. One appeal per report, only
from `action_taken`. D owns `PATCH status` (transition-validated); F reads via
`GET /api/v1/governance/abuse-reports?status=`.

## F8. Provider-policy record (D → E admin UI, F triage reference)

Fields per D §3: `provider_key, scope{global|organization}, org_id?,
display_name, terms_url, aup_url, privacy_url, dpa_url, status_page_url,
commercial_use_allowed?, training_on_inputs{no|opt-in|opt-out|yes|unknown},
retention_summary?, retention_days?, dpa_available, region_pinning_available,
last_reviewed_at?, review_cadence_days=180, source_notes?, is_active`.
Advisory in Wave 2 (no gateway block). Missing upstream field = NULL +
`source_notes="unverified"`, never fabricated.

## F9. Retention precedence (B enforces, A text normative)

Org policy wins over personal for org-scoped traffic; most-restrictive TTL
wins on conflict (`min(retention_days)`); `zero_retention=true` at either
applicable scope short-circuits to no-capture. Choke point: extend
`services/prompt_logging/resolution.py`, no parallel resolver.

## F10. Subprocessor public shape (F → E)

`{name, purpose, location, status}` reads for Trust Center; admin-only fields
(`dpa_ref`, assessments) never public.

## Conflicts resolved

- F's `escalated|closed` abuse states: REJECTED, D's 7-state enum canonical.
- F's `abuse_review_notes` side table: APPROVED only if D agrees; default is
  notes in D's table.
- MASTER_PLAN "no spend caps" line: STALE — per-key caps exist (C evidence);
  gap is global flood guard + fail-open budgets.
- `.env.example` exists at repo root and is the canonical template (G verified
  112 lines) — config lives in `core/config.py`, values in `.env`.
  `backend/src/tollms/core/config.py` + `.env`; orchestrator to confirm
  canonical env template location in Wave 3.
