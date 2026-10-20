import { asNumber, keyStatus, type KeyLifecycleStatus, type KeyStatusInput } from "./StatusPill";
import type { OrgKey } from "@/types/orgs";

/**
 * OrgKey → shared status input. Same basis as the personal table: enabled +
 * expiry + budget + never-used. The org payload is tolerant (snake_case
 * variants), so every field is normalized here — the one place that knows
 * the org shape.
 */
export function orgKeyStatusInput(key: OrgKey): KeyStatusInput {
  return {
    enabled: !key.revoked && key.status !== "revoked" && key.status !== "disabled",
    expires_at: key.expires_at ?? null,
    last_used_at: key.last_used_at ?? key.used_at ?? null,
    policy:
      key.policy?.max_budget_usd === null || key.policy?.max_budget_usd === undefined
        ? null
        : { max_budget_usd: key.policy.max_budget_usd },
  };
}

/** Spend already present on the org row (spend_usd → spend → total). */
export function orgKeySpend(key: OrgKey): number | null {
  return asNumber(key.spend_usd ?? key.spend ?? key.total_spend_usd);
}

/**
 * Single interpretation for org rows: the table badge and the detail pill
 * agree because both route through the shared `keyStatus`.
 */
export function orgKeyStatus(key: OrgKey): KeyLifecycleStatus {
  return keyStatus(orgKeyStatusInput(key), orgKeySpend(key) ?? undefined);
}
