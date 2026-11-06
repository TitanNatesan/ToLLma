# ToLLma Legal Document Set — Index

> All documents are **DRAFT — REQUIRES_LEGAL_REVIEW**. Nothing here is
> publishable or operative until counsel approves and the orchestrator
> publishes via `api/legal` with computed `content_hash` values.

| # | Document (slug) | File | Applicability | Binding / Notice |
|---|---|---|---|---|
| 01 | `terms-of-service` | 01-terms-of-service.md | Cloud | Binding |
| 02 | `privacy-notice` | 02-privacy-notice.md | Cloud (+ guidance for self-host operators) | Binding-as-notice |
| 03 | `cookie-policy` | 03-cookie-policy.md | Cloud | Notice |
| 04 | `data-processing-addendum` | 04-dpa.md | Cloud B2B | Binding |
| 05 | `subprocessor-list` | 05-subprocessor-list.md | Cloud | Notice |
| 06 | `retention-deletion-policy` | 06-retention-deletion.md | Both | Notice (+ normative for Agent B enforcement) |
| 07 | `infosec-overview` | 07-infosec-overview.md | Both | Notice (no certification claims) |
| 08 | `acceptable-use-policy` | 08-acceptable-use.md | Cloud | Binding |
| 09 | `sla` | 09-sla.md | Cloud | Binding (targets counsel-approved) |
| 10 | `support-policy` | 10-support-policy.md | Cloud | Notice |
| 11 | `coordinated-disclosure` | 11-coordinated-disclosure.md | Both | Notice |
| 12 | `responsible-ai-use` | 12-responsible-ai-use.md | Both | Notice + binding reference |
| 13 | `model-provider-disclosure` | 13-model-provider-disclosure.md | Both | Notice |
| 14 | `copyright-dmca` | 14-copyright-dmca.md | Cloud | Notice + binding |
| 15 | `law-enforcement-policy` | 15-law-enforcement-policy.md | Cloud | Notice |
| 16 | `transparency-report` | 16-transparency-report.md | Cloud | Notice |
| 17 | `grievance-redressal` | 17-grievance-redressal.md | Cloud | Binding-notice (DPDP) |
| 18 | `age-eligibility` | 18-age-eligibility.md | Cloud | Binding-notice |
| 19 | `selfhost-operator-guide` | 19-selfhost-operator-guide.md | Community | Notice |
| 20 | `dsr-procedure` | 20-dsr-procedure.md | Cloud | Notice |

## Version table (all pre-publish)

Every document starts at `0.1.0-draft` with `content_hash: PENDING`.
The orchestrator's publish tooling computes `sha256:<hex>` over canonical
markdown (LF, no front-matter) per INTERFACE_FREEZE.md F1.

| slug | version | content_hash | status |
|---|---|---|---|
| terms-of-service | 0.1.0-draft | PENDING | DRAFT |
| privacy-notice | 0.1.0-draft | PENDING | DRAFT |
| cookie-policy | 0.1.0-draft | PENDING | DRAFT |
| data-processing-addendum | 0.1.0-draft | PENDING | DRAFT |
| subprocessor-list | 0.1.0-draft | PENDING | DRAFT |
| retention-deletion-policy | 0.1.0-draft | PENDING | DRAFT |
| infosec-overview | 0.1.0-draft | PENDING | DRAFT |
| acceptable-use-policy | 0.1.0-draft | PENDING | DRAFT |
| sla | 0.1.0-draft | PENDING | DRAFT |
| support-policy | 0.1.0-draft | PENDING | DRAFT |
| coordinated-disclosure | 0.1.0-draft | PENDING | DRAFT |
| responsible-ai-use | 0.1.0-draft | PENDING | DRAFT |
| model-provider-disclosure | 0.1.0-draft | PENDING | DRAFT |
| copyright-dmca | 0.1.0-draft | PENDING | DRAFT |
| law-enforcement-policy | 0.1.0-draft | PENDING | DRAFT |
| transparency-report | 0.1.0-draft | PENDING | DRAFT |
| grievance-redressal | 0.1.0-draft | PENDING | DRAFT |
| age-eligibility | 0.1.0-draft | PENDING | DRAFT |
| selfhost-operator-guide | 0.1.0-draft | PENDING | DRAFT |
| dsr-procedure | 0.1.0-draft | PENDING | DRAFT |

## Conventions

- `Status: DRAFT — REQUIRES_LEGAL_REVIEW` header on every file.
- Unknown names, addresses, contacts: `[PLACEHOLDER:...]` tokens only —
  never invented. See `docs/compliance/legal/LEGAL_REVIEW.md` item L-17.
- Jurisdiction notes lead with India (DPDP Act 2023); see
  `docs/compliance/legal/APPLICABILITY.md` for the worldwide skeleton.
- "Binding" documents create user obligations; "Notice" documents are
  informational and create none. The label is stated per file.
