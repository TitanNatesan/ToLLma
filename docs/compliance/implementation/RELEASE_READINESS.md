# Release Readiness

NOT READY for production release — correctly so: this wave delivers the technical framework; legal/operational gates remain.

Green: P0 technical requirements implemented + verified (matrix), full suite 1227 green, audit with no Critical, migration rollback-tested, frontend + e2e green.
Blocking production: counsel approval (L-02/L-17 minimum), CI first green run, public-route decision, backup drill, curator verification of provider registry, contact/placeholder substitution.
Recommended next: (1) enable trust-security.yml, triage baseline; (2) counsel review batch 1 (ToS/Privacy/DPA/AUP/grievance); (3) appoint Grievance Officer; (4) backup drill; (5) Wave 4 hardening (MFA, KEK rotation op, C2 flood guard, gateway denylist) per product priority.
Working tree holds all changes uncommitted for human review (per git-safety rules, nothing staged/committed/pushed).
