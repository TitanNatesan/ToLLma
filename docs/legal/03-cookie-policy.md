# Cookie Policy (DRAFT)

- Status: DRAFT — REQUIRES_LEGAL_REVIEW
- slug: `cookie-policy` · version: `0.1.0-draft` · content_hash: PENDING
- Applicability: Cloud hosted web surfaces.
- Type: Notice · Jurisdiction notes: DPDP-first; ePrivacy/GDPR opt-in
  question for analytics/marketing tracked in L-09.

## 1. Strictly necessary (no opt-out)

- Session cookies: short-lived access token (~15 min), rotating refresh
  token (~30 days), session marker. Purpose: authentication.
- Security cookies: OAuth state/PKCE binding, login-attempt and
  resend-cooldown limiters, CSRF/session flags. Without these the service
  cannot function.

## 2. Preferences (functional, consent category `functional`)

UI/chat preferences (theme, accent, behavior). Stored per account,
non-withdrawable while the account exists (see F4 consent enum).

## 3. Optional categories (off until consented, withdrawable)

- `analytics`: product telemetry, if ever introduced — currently the
  product surface reports "not tracked" rather than inventing data.
- `marketing`: reserved; no marketing cookies or writers exist today.
- `prompt_logging` and `third_party_sharing` are consent categories, not
  cookies, and are governed by the Privacy Notice and DPA respectively.

## 4. Management

Browser controls plus in-product settings (Agent E settings surface).
Withdrawing an optional category stops future collection; it does not
retro-delete already-aggregated statistics (disclosed here, not hidden).

## 5. Third-party cookies

None by design on the application surface. Any future marketing site
embeddings require a separate opt-in banner per L-09 before deployment.
