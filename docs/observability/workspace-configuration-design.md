# Workspace Ownership + Authorization Audit → Observability Configuration Design (Agent 3)

- **Phase:** 1 READ-ONLY. This doc is the only write.
- **Pre-check:** `git status --short` → only untracked `docs/observability/` drafts.
- **Builds on (not duplicates):** Agent 1 `langfuse-capability-inventory.md` (Langfuse surface), Agent 2 `backend-gap-audit.md` (ToLLma capture→storage→API evidence, §§1–15). Normative code refs below are the contract; the backend-gap handoff note ("settings model + resolution semantics … reuse verbatim") is honored in §2.
- **Rules honored:** `backend.md` (feature-service layering, no new top-level package without trio), `database.md` (XOR ownership, UUID PKs, indexes), `AGENTS.md` (no hacks, no duplicated logic).

## 1. Actual ownership model (as implemented)

### 1.1 Entities + relationships (evidence)

| Entity | Table / file | Owner columns | Relationships | Notes |
|---|---|---|---|---|
| `User` | `models/user.py:36-54` | — (identity root) | `providers`, `conversations`, `prompt_logging_settings`, `prompt_logs` (`user.py:115-120`) | `platform_role` is platform-level only; org roles live on memberships (`user.py:86-93`). |
| `Organization` | `models/organization.py:56-86` | `root_user_id` FK `users.id` (not nullable) | `memberships`, `permission_sets`, `teams`, `api_keys`, `providers`, `guardrail_policies/triggers`, `prompt_logging_settings`, `prompt_logs`, `benchmark_runs` | `status` (`active/disabled`), `max_spend`, `audit_retention_days`. |
| `Membership` | `models/organization.py:89-107` | `org_id` + `user_id`, `is_root`, `state` (`active/suspended/removed`) | `sets` (direct), `team_memberships` | Live uniqueness `(org_id, user_id)` partial (`is_deleted = false`). Only `ACTIVE` + live counts (`guards.py:282-289`). |
| `PermissionSet` / codes | `models/organization.py:110-147`, `api/orgs/common/guards.py:30-124` | `org_id` nullable (system sets), `created_by/updated_by` | `permissions` (codes), `team_sets` | Catalog includes `PromptLogs.{Read,ViewContent,Manage,Delete}` (`guards.py:110-115`), `Organization.*`, `Keys.*`, `Analytics.*`, `Audit.*`, `Guardrails.*`. Prereq ladder exempts `PromptLogs` so custodial erase works without read (`guards.py:127-134`). |
| `Team` | `models/organization.py:149-207` | `org_id`; **owns nothing** (module docstring `organization.py:1-7`, class docstring `:150-151`) | `team_memberships` (by `membership_id`, hard-delete rows), `team_sets` | Flat grouping. Effective perms = union of direct sets + team sets reachable via caller's own ACTIVE membership (`guards.py:302-344`). Deleting a team drops link rows only. **No team-level config exists anywhere — do not reintroduce (see §4.5).** |
| `ApiKey` | `models/api_key.py:46-150` | `user_id` (owner/assignee, CASCADE), `org_id` nullable (SET NULL), `issued_by` | `policy`, `ip_rules`, `model_permissions`, `prompt_logs`, `prompt_logging_key_targets/overrides` | `org_id IS NULL` = personal; set = org-scoped. Partial UQs: org name live (`api_key.py:59-65`), one primary + one default per personal user (`:69-89`). |
| `Provider` | `models/provider.py` (via key-service usage) | `user_id` + `org_id` mirror of key scoping | — | Personal scope = owner-only; org scope = `org_id` set. Key model-permission validation enforces visibility + `require_org_id` at issuance (`api/keys/service.py:182-261`). |
| `PromptLoggingSetting` | `models/prompt_logging.py:31-78` | **XOR:** `user_id XOR org_id` (`CheckConstraint ck_prompt_logging_settings_owner_scope`, `:34-38`) | `key_targets`, `key_overrides` (cascade delete) | Live uniqueness per scope (partial UQs `:41-52`). Personal: `org_id IS NULL, user_id = owner`. Org: `org_id` set, `user_id NULL`. |
| `PromptLoggingKeyTarget` / `KeyOverride` | `models/prompt_logging.py:81-132` | `setting_id` + `api_key_id` link rows, no soft-delete | — | Targets = eligibility set (empty in keys mode logs nothing). Overrides: `True` force-on / `False` veto / `NULL` inherit (= no row; API deletes NULL rows). |
| `PromptLog` (ledger) | `models/prompt_logging.py:135-216` | `user_id`, `org_id`, `api_key_id` (all SET NULL), `workspace_type`, `key_provenance`, `match_source` | `owner`, `organization`, `api_key`, `conversation`, `provider`, `model` | Immutable append-only; idempotency `(request_id, generation_id)` partial UQ (`:154-160`); legacy `match_source="team"` value retired (comment `:177-181`). |
| `RetentionPolicy` | `models/privacy.py:93-136` | **Same XOR** (`ck_retention_policies_owner_scope`, `:99-102`), per-scope per-category live UQs | — | Categories incl. `prompt_logs/request_logs/api_request_logs` (`:82-90`). `zero_retention` at any applicable scope suppresses capture (F9). |
| `ApiRequestLog` / `RequestLog` | `models/api_key.py:223-275`, `models/request_log.py` | `user_id`, `org_id` (column-only on API log, no relationship — `api_key.py:244-249`), `api_key_id` | — | Aggregates only, no payloads. `usage_estimated` flags estimates (absent on `PromptLog` — Agent 2 §8 P0). |

### 1.2 Key scoping + provenance (authoritative row wins)

- **Personal vs org keys:** `api/keys/service.py:54-65` — personal select pins `org_id IS NULL`; org keys live exclusively in `api/keys/organization_service.py` (canonical; `api/orgs/keys/service.py:1-8` is a re-export facade).
- **Issuance:** org keys require ACTIVE membership + `Keys.Create` (`organization_service.py:108-131`); assignee must hold ACTIVE membership; provider/model scopes pinned to the key's own org (`require_org_id` — `api/keys/service.py:235-236,255-256`). Raw key shown once, only hash stored (`api_key.py:104-107`).
- **Auth:** `services/api_keys/keys.py: KeyContext.org_id` = owning org (`:91-94,228`); `authenticate()` backstops assignee ACTIVE membership (`:353-429`). Tombstone + context invalidation on delete/rotate.
- **Provenance at capture:** `services/prompt_logging/resolution.py:175-198` (`_derive_provenance`) — the **key row is authoritative**; the `key_provenance` hint applies only with no key row; lookup-exception yields `("unknown", None)` → fail-closed no-capture. Internal plane passes `key_provenance=None` (`api/gateway/service.py:719-730`, `services/generation.py:551`); public gateway passes a hint derived from `ctx.org_id` (`api/public_gateway/service.py:769-770`) — harmless because the resolver re-derives from the row.

### 1.3 Who can configure prompt logging today

| Scope | Read | Write | Evidence |
|---|---|---|---|
| Personal setting | owner only (no perm check; `_scope` returns early for `org_id None`) | owner only | `api/prompt_logging/settings.py:37-42` (`_scope`), `:134-136` (`get_settings`), `:196-202` (`upsert_settings`) |
| Org setting | ACTIVE membership + `PromptLogs.Read` (`_scope` → `_member_org` + `_require_perm`) | ACTIVE membership + `PromptLogs.Manage` | same `_scope`; `set_key_state` also `Manage`-gated (`settings.py:292-297`) |
| Org key targets / states | same as setting read | `Manage`; keys workspace-pinned (`_validate_keys`: personal callers need `key.org_id IS NULL AND key.user_id == caller`; org callers need `key.org_id == org_id`, else generic 404 — `settings.py:139-167`) | `settings.py:139-183` |
| Log listing / detail | personal: own rows; org: ACTIVE + `PromptLogs.Read`, bodies additionally need `PromptLogs.ViewContent` (personal always true; org needs grant or root) | — | `api/prompt_logging/records.py:34-42`, `:258-266` |
| Delete / purge | — | personal: owner; org: `PromptLogs.Delete` (exempt from read-prerequisite ladder) | `records.py:307-364`; `guards.py:127-134` |
| Retention policies (privacy) | personal: owner; org: **any ACTIVE membership** (`_require_org_member` checks `effective_permissions` non-empty, no code) | same | `api/privacy/service.py:139-150`, `:175-180` — **weaker than `PromptLogs.Manage`; see risk R1** |

Cross-workspace misses are 404 oracles everywhere (never 403): settings (`settings.py:1-6` docstring), records (`records.py:45-86`), key/provider/model filters (`records.py:56-85`).

## 2. Current configuration precedence (as ACTUALLY implemented in `resolution.py`)

Authoritative: `services/prompt_logging/resolution.py:1-30` (module contract) + `resolve_setting` (`:229-278`); row materialization in `services/prompt_logging/capture.py:36-117`.

### 2.1 Resolution order (verbatim semantics)

1. **Workspace pin first** (`_derive_provenance`, `resolution.py:175-198,252`): key row → `("organization", key.org_id)` or `("personal", None)`; no key row → hint or `personal`; exception → `("unknown", None)` → **no-capture**.
2. **Zero-retention short-circuit** (`:53-89,256-257`): any `zero_retention` policy at applicable scope for `prompt_logs` → **no-capture**. Fail-open `False` on DB error (preserves capture; see risk R3).
3. **Org leg** (`:258-267`): needs `scope_org` (key org wins over `org_id` hint) **and** `user_id` non-None, else no-capture. Live setting (`_live_setting_for_org`: `is_deleted=false AND org_id == X`) missing/disabled → no-capture. `global` → `(setting, "global")`; else keys-mode matcher.
4. **Personal leg** (`:268-275`): needs `user_id`; live setting for `(org NULL, user_id)`; same global/keys branch. **Org policy never governs personal-key traffic; personal-key traffic resolves only the personal setting** (`:25-28`). Unkeyed legacy traffic resolves the personal setting of the user.
5. **Keys-mode matcher** (`:201-226`): override `False` → veto; `True` → `(setting, "key")`; else inherit → listed-live-key hit required (`_key_live` checks deletion only — revoked/disabled keys already fail auth upstream, `:155-172`). Empty targets → no-capture, **never falls back to global**. Team membership never influences logging (`:22-23`).
6. **Mandatory-global guard (API side):** while enabled+global, any explicit key force-off is 422 — including forged requests; inherit (`NULL`) is not a disable (`settings.py:186-193`, `:277-282`). Global upsert **clears stored targets** (`settings.py:219-222`).

### 2.2 Effective config (what gets written)

`capture.build_row_kwargs` (`capture.py:78-113`): `workspace_type`/`org_id`/`key_provenance` are stamped **from the resolved setting's scope** (`setting.org_id`), not the caller hint; `match_source` from resolution; `capture_input/output` flags gate Fernet encryption; `retention_days` → per-row `expires_at` (`NULL` = keep forever); `policy_version = setting.version`. Disabled/absent setting → `None` (skip). API read of an absent setting surfaces a disabled default (`enabled False, capture none, mandatory False, scope all, retention 90` — `settings.py:81-104,107-131`).

### 2.3 Platform defaults (the actual "layer 0")

`PromptLoggingSetting.enabled=False`, `capture_input/output=False`, `mode="global"`, `retention_days=90` default / `NULL` keep-forever (`models/prompt_logging.py:63-67`; `settings.py:33,208-237`). **Default-off: the ledger is empty unless a workspace opts in** (Agent 2 default-off warning). There is no separate platform observability policy table; the "platform default" is these column defaults + fail-closed no-capture.

So the real precedence today is:

```text
platform column defaults (off)
  → workspace setting (personal XOR org; enabled + mode + flags + retention_days)
    → zero-retention veto (privacy policy, either scope)
      → key leg within the setting (global match | keys allow-list + override)
        → effective row kwargs (scope stamp, ciphers, expires_at)
```

"API-key overrides" are **not** an independent layer above the workspace — they are legs *inside* the workspace setting.

### 2.4 Retention interplay (two mechanisms, one confusion)

- **Setting TTL:** `setting.retention_days` → `expires_at` at capture; daily `promptlog-cleanup` NULLs ciphers, keeps metadata; explicit `purge_logs` same; `delete_log` hard-deletes one row (`backend-gap §11`; `records.py:307-364`).
- **Privacy policy:** `RetentionPolicy.zero_retention` suppresses capture (F9; `resolution.py:53-89` + `api/privacy/service.py:220-261` twin `resolve_retention`). Non-zero `retention_days` on the policy does **not** re-stamp existing rows — `expires_at` is fixed at capture from the *setting*. Later setting changes don't restamp either; only the sweep + explicit purge apply.
- Per-row `expires_at` uses the *setting's* TTL, while the privacy resolver merges personal+org lists with most-restrictive-wins (`privacy/service.py:226-243`) and the capture path checks only `user==user AND org==org` rows — equivalent outcomes for the zero case, divergent code paths (keep in sync by freeze F9).

## 3. Cross-workspace risks found

- **R1 — Retention-policy writes under-gated (strongest finding).** Org `RetentionPolicy` upsert requires only *any* ACTIVE membership (`privacy/service.py:139-150`), while the org prompt-logging setting requires `PromptLogs.Manage`. A member with no `PromptLogs.*` grant can set `zero_retention` for `prompt_logs` and silently suppress the workspace's capture — a cross-privilege veto, not a cross-workspace leak. Fix in §4 (route through `PromptLogs.Manage` or a new `Observability.Manage`).
- **R2 — Org traffic without `user_id` silently uncaptured.** `resolve_setting` returns no-capture when org provenance resolves but `user_id is None` (`:260-261`); `_zero_retention_applies` also returns `False` for `user_id None` (`:61-62`). Key-only/service paths therefore lose observability instead of attributing to the org. No leak, but a coverage hole for gateway-issued keys whose context always carries `user_id` today — brittle if a future caller omits it.
- **R3 — Fail-direction inconsistency.** Resolution errors fail **closed** (no-capture); the zero-retention check fails **open** (capture preserved, `resolution.py:87-89`). A DB blip during an active zero-retention policy captures rows the workspace forbade. Both directions are defensible alone; the mix means error handling, not policy, decides. Recommend: keep fail-closed for resolution, make the zero check fail-closed too when a policy *was previously known* (cache last-known-zero), or at minimum emit `gateway.promptlog.dropped`-style counter on zero-check error.
- **R4 — `org_id` hint accepted but ignored (by design, audit note).** `build_row_kwargs(org_id=…)` + `resolve_setting(org_id=…)` take an `org_id` param that loses to the key row (`:259`). Safe, but two call sites pass different things (`None` internal, `ctx.org_id` public). A future reader may "fix" the hint into authority and divert the ledger — the module docstring already warns; keep the warning and add a debug assertion that `org_id hint == key org` when both present.
- **R5 — Stale key-target rows.** Capture checks only deletion (`_key_live`); disabled/expired/revoked keys fail auth upstream so no rows arrive, but their target/override rows linger and re-activate if the key is re-enabled. Intended (targets are config, not liveness), but `retention_info`/settings UI should surface `key_states` for dead keys distinctly from live-deny.
- **R6 — Two TTL truths.** Operators can set both `PromptLoggingSetting.retention_days` (effective at capture) and `RetentionPolicy.retention_days` (no per-row effect except zero). Expectation mismatch: "I set 30d in Privacy, why do old rows keep 90d stamps?" Document single-pane rule in §4 (setting TTL is the stamper; policy TTL is advisory until unified).
- **R7 — Global upsert destroys keys config.** `mode global` clears stored targets/overrides (`settings.py:219-222`). Downgrade keys→global→keys loses the allow-list. Acceptable if deliberate; UI must confirm.
- **R8 — Read/write asymmetry on retention info.** Org `retention_info` requires `PromptLogs.Read` (`records.py:367-378`) while `set_retention` requires only membership (R1's read side is stricter than its write side — backwards).
- **What was NOT found:** no cross-workspace *read* leak (404 oracles hold on settings, rows, keys, providers, models); no team-scoped bypass (teams own nothing, resolution ignores teams); no hint-forgery diversion (key row wins); no provider-org confusion (key org attributes, `api/gateway/service.py:719-723`).

## 4. Proposed workspace-owner-controlled observability configuration

### 4.1 Hierarchy (normative)

```text
L0 platform defaults (code + column defaults; capture OFF)
  → L1 workspace-owner settings (personal owner | org root/Manage-holders)
    → L2 observability config (display/export/retention-view knobs; same owner)
      → L3 key legs (allow-list + per-key override, inside the workspace setting)
        → L4 effective config (resolved per call; fail-closed no-capture)
```

- **Downward rule (security): settings never weaken downward.** A lower layer may only *narrow* what an upper layer permits for security-sensitive flags: `enabled` global-mandatory cannot gain per-key force-offs (already enforced, `settings.py:186-193`); `capture_input/output` off at L1 cannot be re-enabled at L3 (already the case — L3 only selects *which keys*, never widens flags); minimum `retention_days` for audit rows and any future PII-redaction flag are floors, not defaults. Non-security knobs (list page size, export format, dashboard grouping) vary freely downward.
- **Upward rule:** L3/L4 never widen L1. Overrides are `{True force-on within allow-list, False veto, NULL inherit}` — `True` captures only under an enabled setting; it cannot enable a disabled workspace.
- **No team layer.** Teams remain permission conduits only. Any setting keyed by `team_id` is rejected (no column, no API, no resolver branch). Rationale: teams own nothing (`organization.py:1-7`); per-team capture would fork the ledger's workspace invariant (`workspace_type ∈ {personal, organization}`) and the XOR ownership constraint.
- **Multi-workspace independence guarantee:** resolution is a pure function of `(api_key_id → {personal, org}) → exactly one setting`. Org traffic reads only the key's org setting; personal traffic only the caller's personal setting (`resolution.py:25-28`). Property tests: (i) org key + personal setting enabled → no-capture; (ii) personal key + org setting enabled → no-capture; (iii) key-org-A hint-org-B → attributes A; (iv) suspended member's key → auth fails before resolution; (v) unknown key exception → no-capture, no personal fallback.

### 4.2 Per-setting table (implementable; named checks/tables)

`T = PromptLoggingSetting` (reuse) unless "New table" says otherwise. Checks are `api/orgs/common/guards.py` primitives.

| # | Setting | L | Default (L0) | Who can change (named check) | Override behavior (L3) | Mandatory? | Affects historical rows? |
|---|---|---|---|---|---|---|---|
| S1 | `enabled` | L1 (`T.enabled`) | `False` | personal: owner (no check, `_scope` early-return); org: `_member_org` + `_require_perm(…, "PromptLogs.Manage")` (`settings.py:37-42,196-202`) | keys mode: per-key `False` vetoes, `True` captures within enabled setting; global mode: no force-off (422) (`settings.py:186-193`) | **yes when global+enabled** (mandatory policy; `effective_summary.mandatory`, `settings.py:101`) | No — gates future captures only |
| S2 | `mode` (`global`/`keys`) | L1 (`T.mode`) | `global` | same as S1 | selects L3 matcher; empty targets in `keys` = log nothing, never global fallback (`resolution.py:217-218`) | structural, not weaken-able | No |
| S3 | `capture_input` / `capture_output` | L1 (`T.capture_input/output`) | `False`/`False` | same as S1 | L3 cannot widen: override `True` captures with the *setting's* flags, never flips them (`capture.py:99-100`) | no (owner may narrow anytime) | No — flags evaluated at capture; old ciphers keep old policy (`policy_version` stamped per row, `capture.py:109`) |
| S4 | `retention_days` (`NULL` = forever) | L1 (`T.retention_days`) | `90` (`settings.py:33`); explicit `NULL` persists (`settings.py:229-237`) | same as S1; **route privacy `RetentionPolicy` writes for `prompt_logs` through the same check** (fixes R1/R8) | n/a (not per-key) | floor only: L1 may raise, never lower below platform minimum if one is later set (rule, no minimum today) | Only via sweep/purge: stamps `expires_at` at capture (`capture.py:111-112`); later changes don't restamp (documented; Agent 2 §11) |
| S5 | `zero_retention` (F9 kill-switch) | L1 (privacy `RetentionPolicy.zero_retention`, same XOR scope) | `False` | **same as S1** (change from any-member to `PromptLogs.Manage`; personal: owner) — closes R1 | n/a — vetoes all capture at scope (`resolution.py:53-89`) | yes (veto is absolute) | No — suppresses future captures; existing rows need explicit purge |
| S6 | key allow-list (`key_targets`) + `key_overrides` | L3 (same tables) | empty (= global matches all; keys mode matches none) | same as S1 + `_validate_keys` workspace pin + `_mandatory_guard` (`settings.py:139-167,277-282`) | inherit default `True` for listed keys; explicit `False` veto / `True` force-on (`settings.py:62-78`; `resolution.py:201-226`) | cannot weaken global-mandatory | No |
| S7 | read vs body visibility | L1-derived (no new flag; enforce existing codes) | metadata readable, bodies gated | bodies: personal always; org `_require_perm(…, "PromptLogs.ViewContent")` (`records.py:258-266`); erase: `PromptLogs.Delete` (prereq-exempt) | n/a | n/a | No |
| S8 | export / warehouse read | L2 future | no ledger export today (Agent 2 §12 P1) | when built: org `_require_perm(…, "Analytics.Export")` (exists in catalog, `guards.py:90-95`); personal: owner | n/a | n/a | n/a (new surface) |

### 4.3 Named permission checks (no new plumbing)

- Keep `_scope(db, caller, org_id, code)` + `_member_org` + `_require_perm` (`settings.py:37-42`; `guards.py:356-374`). Org observability writes use **`PromptLogs.Manage`**; reads **`PromptLogs.Read`**; bodies **`PromptLogs.ViewContent`**; erase **`PromptLogs.Delete`**.
- **Fix R1/R8:** `api/privacy/service.py:_require_org_member` gains an optional `code` param defaulting to `None` (preserving current behavior for non-observability categories); callers with `data_category == "prompt_logs"` (and later any observability-governed category) pass `code="PromptLogs.Manage"` for writes and `code="PromptLogs.Read"` for `retention_info`-equivalents. No catalog change.
- If a future surface needs read/write split beyond prompt logs (dashboards, exports, score configs), add one group to `PERMISSION_GROUPS` — proposed `Observability: [Read, Manage, Export]` — and migrate S8 to it; do **not** mint per-team or per-key codes.

### 4.4 Named tables: reuse first, justify anything new

- **Reuse `prompt_logging_settings`** for S1–S4+S6 (semantics match exactly: XOR workspace scope, live uniqueness, versioned upsert, key legs). No schema change required for the hierarchy above.
- **Reuse `retention_policies`** for S5 (scope XOR already mirrors settings; fix is authz, not schema).
- **`observability_settings`: NOT proposed in Phase 1.** Justification gate for ever creating it: a workspace-level knob that (i) is not capture policy (so `prompt_logging_settings` is the wrong home), (ii) is not retention (so `retention_policies` is wrong), and (iii) needs the same XOR scope + live-UQ + versioned-upsert pattern — e.g. workspace display redaction defaults, export enablement, or score-annotation policy. If all three hold, create `observability_settings(user_id XOR org_id, version, updated_by, …)` mirroring `prompt_logging_settings:34-53` + partial UQs, gated by the §4.3 checks, resolved read-only at API time (never in the capture hot path). Until then, YAGNI: no new table.
- Column additions to `PromptLog` (cost, token breakdown, `usage_estimated`) are Agent 5's data-architecture decision (Agent 2 §§8–9); this design requires only that new columns remain workspace-stamped at capture from the resolved setting (same `capture.py:78-90` pattern) so §4.1 independence holds.

### 4.5 Explicit non-goals (binding)

1. No `team_id` on any settings/ledger table; no team branch in `resolve_setting`; no `match_source="team"` revival (legacy value stays historical only).
2. No per-key widening: L3 selects keys, never flags, TTLs, or visibility.
3. No cross-workspace reads: every new listing endpoint reuses `_scope_stmt` workspace pin + 404 oracle (`records.py:34-42` pattern).
4. No silent global→keys data loss surprise: keep the clear-on-global behavior but require explicit UI confirm (R7).
5. No second resolver: capture-path `resolution.py` stays authoritative; any privacy-twin (`resolve_retention`) stays a mirror kept in sync by freeze F9, never a parallel precedence.

## Completion contract

- [x] `git status --short` pre-check (read-only; only `docs/observability/` untracked).
- [x] Read `AGENTS.md`, `.opencode/rules/backend.md`, `.opencode/rules/database.md`, `FILE_OWNERSHIP.md`, Agent 1 inventory, Agent 2 gap audit — built on, not duplicated.
- [x] Inspected `models/organization.py`, `models/user.py`, `models/api_key.py`, orgs permissions (`api/orgs/common/guards.py`), prompt-logging settings ownership (`models/prompt_logging.py`, `api/prompt_logging/settings.py`, `services/prompt_logging/resolution.py`), key auth (`services/api_keys/keys.py`, `api/keys/service.py`, `api/keys/organization_service.py`), proxy/middleware workspace resolution (`api/gateway/service.py`, `api/public_gateway/service.py`, `services/generation.py`), privacy retention interplay (`models/privacy.py`, `api/privacy/service.py`).
- [x] Delivered (a) ownership model + evidence, (b) precedence as implemented, (c) cross-workspace risks, (d) hierarchy + per-setting table + downward rule + no-teams + independence guarantee, all implementable with named settings/checks/tables.
- [x] Wrote ONLY `docs/observability/workspace-configuration-design.md`. No other files, no git writes.
- **Handoff:** Agent 5 (data architecture) owns join-key + `PromptLog` column additions; Agent 6 (security) confirms R1 fix direction + `Delete`-code split note (Agent 2 §14); Orchestrator Phase 2 folds §4 into `implementation-plan.md` / `configuration-reference.md`.
