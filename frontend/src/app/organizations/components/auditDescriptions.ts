/** Centralized audit-event copy: action → human title/description built ONLY
 * from the target dict. Unknown actions render the "Unknown event" fallback —
 * details are never invented. Secrets are never displayed. */

const SENSITIVE_KEY = /token|secret|credential|password|passwd|private[\s_-]*key|auth|session|cookie|signature/i;

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

export const REDACTED = "••••••";

/** Display a target value safely: sensitive keys are redacted, objects are
 * summarized (never dumped raw — they may nest secrets). */
export function displayAuditValue(key: string, value: unknown): string {
  if (isSensitiveKey(key)) return REDACTED;
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const s = String(value);
    return s.length > 120 ? `${s.slice(0, 120)}…` : s;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "none";
    const prims = value.filter((v) => ["string", "number"].includes(typeof v)) as Array<string | number>;
    if (prims.length === value.length && prims.length <= 8) return prims.join(", ");
    return `${value.length} items`;
  }
  return "recorded";
}

function str(target: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = target[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
}

export interface AuditDescription {
  title: string;
  description: string;
}

type Builder = (target: Record<string, unknown>) => AuditDescription;

function who(target: Record<string, unknown>): string {
  return str(target, "email", "user_email", "name", "user_id", "member_id") ?? "a member";
}

function what(target: Record<string, unknown>): string {
  return str(target, "set_name", "team_name", "key_name", "name", "set_id", "team_id", "key_id") ?? "a resource";
}

/** Known actions. Every builder degrades to generic copy when its target
 * fields are absent — no fabricated identities, counts, or timestamps. */
const KNOWN: Record<string, Builder> = {
  "member.invited": (t) => ({ title: "Member invited", description: `Invitation sent to ${who(t)}.` }),
  "member.added": (t) => ({ title: "Member added", description: `${who(t)} joined the organization.` }),
  "member.removed": (t) => ({ title: "Member removed", description: `${who(t)} was removed. Membership and grants revoked immediately.` }),
  "member.suspended": (t) => ({ title: "Member suspended", description: `${who(t)} was suspended.` }),
  "member.resumed": (t) => ({ title: "Member reactivated", description: `${who(t)} was reactivated.` }),
  "member.sets_assigned": (t) => ({ title: "Permission sets assigned", description: `Grants for ${who(t)} were updated.` }),
  "invitation.created": (t) => ({ title: "Invitation created", description: `Invitation sent to ${who(t)}.` }),
  "invitation.resent": (t) => ({ title: "Invitation resent", description: `A fresh invitation link was sent to ${who(t)}.` }),
  "invitation.revoked": (t) => ({ title: "Invitation revoked", description: `The invitation for ${who(t)} was revoked.` }),
  "invitation.accepted": (t) => ({ title: "Invitation accepted", description: `${who(t)} accepted the invitation.` }),
  "request.approved": (t) => ({ title: "Join request approved", description: `The join request from ${who(t)} was approved.` }),
  "request.rejected": (t) => ({ title: "Join request rejected", description: `The join request from ${who(t)} was rejected.` }),
  "set.created": (t) => ({ title: "Permission set created", description: `Permission set ${what(t)} was created.` }),
  "set.updated": (t) => ({ title: "Permission set updated", description: `Permission set ${what(t)} was updated.` }),
  "set.deleted": (t) => ({ title: "Permission set deleted", description: `Permission set ${what(t)} was deleted.` }),
  "set.cloned": (t) => ({ title: "Permission set cloned", description: `Permission set ${what(t)} was cloned as a snapshot copy.` }),
  "team.created": (t) => ({ title: "Team created", description: `Team ${what(t)} was created.` }),
  "team.updated": (t) => ({ title: "Team updated", description: `Team ${what(t)} was updated.` }),
  "team.deleted": (t) => ({ title: "Team deleted", description: `Team ${what(t)} was deleted.` }),
  "key.created": (t) => ({ title: "API key created", description: `API key ${what(t)} was created. The secret was shown once at creation.` }),
  "key.revoked": (t) => ({ title: "API key revoked", description: `API key ${what(t)} was revoked.` }),
  "org.updated": (t) => ({ title: "Organization updated", description: str(t, "field", "fields") ? `Updated: ${str(t, "field", "fields")}.` : "Organization profile or settings were updated." }),
  "budget.updated": (t) => ({ title: "Budget updated", description: "The organization budget cap was updated." }),
  "provider.created": (t) => ({ title: "Provider connected", description: `Provider ${what(t)} was connected.` }),
  "provider.removed": (t) => ({ title: "Provider removed", description: `Provider ${what(t)} was removed.` }),
};

/** Human title/description for an audit event. Unknown actions fall back to
 * "Unknown event (raw action)" — never fabricated. */
export function describeAuditEvent(action: string, target: Record<string, unknown>): AuditDescription {
  const t = target ?? {};
  const direct = KNOWN[action] ?? KNOWN[action.toLowerCase()];
  if (direct) return direct(t);
  return { title: `Unknown event (${action})`, description: "This event type isn't recognized by this client. Raw details are shown below." };
}

/** Safe target rows for the detail drawer: redacted, primitives only. */
export function auditTargetRows(target: Record<string, unknown>): Array<{ key: string; value: string }> {
  return Object.entries(target ?? {})
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .slice(0, 24)
    .map(([k, v]) => ({ key: k, value: displayAuditValue(k, v) }));
}
