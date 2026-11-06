# Jurisdiction Applicability Matrix (skeleton — DRAFT)

- Status: DRAFT — REQUIRES_LEGAL_REVIEW (every cell below is a
  counsel-unverified placeholder; L-11 tracks confirmation).
- Owner: Agent A. Consumers: all agents for scoping; Agent E for locale
  notices; orchestrator for release gating.

## How to read

Rows are jurisdictions; columns are the questions each document must
answer. Cells marked DRAFT are working assumptions, not advice.

| Jurisdiction | Age threshold | Consent model | Breach clock | DPO / grievance duty | Transfer mechanism |
|---|---|---|---|---|---|
| IN — DPDP Act 2023 | 18+ service baseline; child's age per Act is <18 (service excludes) — DRAFT | Free, specific, informed, unconditional + parity withdrawal — DRAFT | Notify DPB + affected principals without delay — DRAFT | Grievance Officer + DPB escalation — DRAFT | Government-notified blacklist approach; contracts + safeguards — DRAFT |
| EU — GDPR | 16 default (member-state 13–16); service 18+ baseline holds — DRAFT | Freely given, specific, informed, unambiguous; opt-in — DRAFT | 72h to authority, without undue delay to subjects — DRAFT | DPO where thresholds met; Art. 77 remedies — DRAFT | Adequacy / SCCs / BCRs — DRAFT |
| UK — GDPR | As EU row; UK extension/IDTA for transfers — DRAFT | As EU row — DRAFT | As EU row (UK ICO) — DRAFT | As EU row (UK ICO) — DRAFT | Adequacy / IDTA — DRAFT |
| US — state (CA CPRA baseline) | 18+ baseline; 13–16 opt-in consent (sale/share) — DRAFT | Opt-out for sale/share; opt-in for sensitive data — DRAFT | State AG + consumer notice per state rules — DRAFT | No DPO; AG + private action paths — DRAFT | Contractual; no federal transfer regime — DRAFT |
| BR — LGPD | 12–18 heightened assent; 18+ baseline holds — DRAFT | Consent one of ten bases; purpose-specific — DRAFT | Reasonable time to ANPD + subjects — DRAFT | DPO (encarregado) mandatory — DRAFT | Adequacy / SCC-equivalent clauses — DRAFT |

## Document coverage map (DRAFT)

- `privacy-notice`, `grievance-redressal`, `dsr-procedure`,
  `retention-deletion-policy`: DPDP-first text; GDPR/LGPD annexes pending.
- `cookie-policy`: ePrivacy opt-in question open (L-09) before EU launch.
- `data-processing-addendum`: GDPR Art. 28 annex pending (L-05).
- `copyright-dmca`: IT Act blocking-order duties pending (L-11).

## Maintenance

This matrix is reviewed whenever a new jurisdiction launches, a listed
law is amended, or counsel issues guidance — at least quarterly while
any cell remains DRAFT. Changes reference the L-item that drove them so
the register stays the single source of truth for what is confirmed.
