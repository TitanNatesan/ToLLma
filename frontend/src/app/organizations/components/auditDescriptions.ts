/** Centralized audit-event copy: action → human title/description built ONLY
 *  from the target dict. Unknown actions render a humanized title (never a
 *  bare "Unknown event") — details are never invented. Secrets are never
 *  displayed. */

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
  return (
    str(
      target, "set_name", "team_name", "key_name", "policy_name", "name",
      "set_id", "team_id", "key_id", "policy_id",
    ) ?? "a resource"
  );
}

/** Known actions. Every builder degrades to generic copy when its target
 * fields are absent — no fabricated identities, counts, or timestamps. */
const KNOWN: Record<string, Builder> = {
  "member.invited": (t) => ({ title: "Member invited", description: `Invitation sent to ${who(t)}.` }),
  "member.added": (t) => ({ title: "Member added", description: `${who(t)} joined the organization.` }),
  "member.removed": (t) => ({ title: "Member removed", description: `${who(t)} was removed. Membership and grants revoked immediately.` }),
  "member.suspended": (t) => ({ title: "Member suspended", description: `${who(t)} was suspended.` }),
  "member.resumed": (t) => ({ title: "Member reactivated", description: `${who(t)} was reactivated.` }),
  "member.left": (t) => ({ title: "Member left", description: `${who(t)} left the organization.` }),
  "member.requested": (t) => ({ title: "Join request received", description: `${who(t)} requested to join.` }),
  "member.approved": (t) => ({ title: "Join request approved", description: `${who(t)} was approved to join.` }),
  "member.accepted": (t) => ({ title: "Invitation accepted", description: `${who(t)} accepted the invitation.` }),
  "member.rejected_invite": (t) => ({ title: "Invitation declined", description: `${who(t)} declined the invitation.` }),
  "member.request_rejected": (t) => ({ title: "Join request rejected", description: `The join request from ${who(t)} was rejected.` }),
  "member.sets_assigned": (t) => ({ title: "Permission sets assigned", description: `Grants for ${who(t)} were updated.` }),
  "invitation.created": (t) => ({ title: "Invitation created", description: `Invitation sent to ${who(t)}.` }),
  "invitation.resent": (t) => ({ title: "Invitation resent", description: `A fresh invitation link was sent to ${who(t)}.` }),
  "invitation.revoked": (t) => ({ title: "Invitation revoked", description: `The invitation for ${who(t)} was revoked.` }),
  "invitation.accepted": (t) => ({ title: "Invitation accepted", description: `${who(t)} accepted the invitation.` }),
  "invite.resent": (t) => ({ title: "Invitation resent", description: `A fresh invitation link was sent to ${who(t)}.` }),
  "invite.revoked": (t) => ({ title: "Invitation revoked", description: `The invitation for ${who(t)} was revoked.` }),
  "invite.expired": (t) => ({ title: "Invitation expired", description: `The invitation for ${who(t)} expired before it was accepted.` }),
  "request.approved": (t) => ({ title: "Join request approved", description: `The join request from ${who(t)} was approved.` }),
  "request.rejected": (t) => ({ title: "Join request rejected", description: `The join request from ${who(t)} was rejected.` }),
  "set.created": (t) => ({ title: "Permission set created", description: `Permission set ${what(t)} was created.` }),
  "set.updated": (t) => ({ title: "Permission set updated", description: `Permission set ${what(t)} was updated.` }),
  "set.deleted": (t) => ({ title: "Permission set deleted", description: `Permission set ${what(t)} was deleted.` }),
  "set.cloned": (t) => ({ title: "Permission set cloned", description: `Permission set ${what(t)} was cloned as a snapshot copy.` }),
  "set.assigned": (t) => ({ title: "Permission set assigned", description: `Permission set ${what(t)} was assigned to ${who(t)}.` }),
  "team.created": (t) => ({ title: "Team created", description: `Team ${what(t)} was created.` }),
  "team.updated": (t) => ({ title: "Team updated", description: `Team ${what(t)} was updated.` }),
  "team.deleted": (t) => ({ title: "Team deleted", description: `Team ${what(t)} was deleted.` }),
  "team.member_added": (t) => ({ title: "Team member added", description: `${who(t)} was added to team ${what(t)}.` }),
  "team.member_removed": (t) => ({ title: "Team member removed", description: `${who(t)} was removed from team ${what(t)}.` }),
  "team.sets_assigned": (t) => ({ title: "Team sets assigned", description: `Permission sets for team ${what(t)} were updated.` }),
  "key.created": (t) => ({ title: "API key created", description: `API key ${what(t)} was created. The secret was shown once at creation.` }),
  "key.issued": (t) => ({ title: "API key issued", description: `API key ${what(t)} was issued to ${who(t)}. The secret was shown once at creation.` }),
  "key.rotated": (t) => ({ title: "API key rotated", description: `API key ${what(t)} was rotated. The previous secret stopped working immediately.` }),
  "key.revoked": (t) => ({ title: "API key revoked", description: `API key ${what(t)} was revoked.` }),
  "key.updated": (t) => ({ title: "API key updated", description: `API key ${what(t)} was updated.` }),
  "key.policy_updated": (t) => ({ title: "API key policy updated", description: `Rate, budget, or model policy for API key ${what(t)} was updated.` }),
  "key.ip_rules_updated": (t) => ({ title: "API key IP rules updated", description: `IP allowlist for API key ${what(t)} was updated.` }),
  "key.models_updated": (t) => ({ title: "API key models updated", description: `Model permissions for API key ${what(t)} were updated.` }),
  "org.created": (t) => ({ title: "Organization created", description: `Organization ${str(t, "org_name", "name") ?? "was created"}.` }),
  "org.updated": (t) => ({ title: "Organization updated", description: str(t, "field", "fields") ? `Updated: ${str(t, "field", "fields")}.` : "Organization profile or settings were updated." }),
  "budget.updated": (t) => ({ title: "Budget updated", description: "The organization budget cap was updated." }),
  "budget.cap_changed": (t) => ({ title: "Budget cap changed", description: "The organization spend cap was changed." }),
  "provider.created": (t) => ({ title: "Provider connected", description: `Provider ${what(t)} was connected.` }),
  "provider.updated": (t) => ({ title: "Provider updated", description: `Provider ${what(t)} was updated.` }),
  "provider.removed": (t) => ({ title: "Provider removed", description: `Provider ${what(t)} was removed.` }),
  "provider.deleted": (t) => ({ title: "Provider removed", description: `Provider ${what(t)} was removed.` }),
  "model.created": (t) => ({ title: "Model registered", description: `Model ${what(t)} was registered.` }),
  "model.updated": (t) => ({ title: "Model updated", description: `Model ${what(t)} was updated.` }),
  "model.deleted": (t) => ({ title: "Model deleted", description: `Model ${what(t)} was deleted.` }),
  "prompt_logs.settings.update": (t) => ({ title: "Prompt logging settings updated", description: str(t, "field", "fields") ? `Updated: ${str(t, "field", "fields")}.` : "Prompt logging capture policy was updated." }),
  "prompt_logs.log.delete": (t) => ({ title: "Prompt log deleted", description: `Prompt log ${str(t, "log_id", "request_id") ?? "was deleted"}.` }),
  "prompt_logs.purge": (t) => ({ title: "Prompt logs purged", description: "Expired prompt-log message bodies were purged. Metadata was kept." }),
  "guardrail.created": (t) => ({ title: "Guardrail created", description: `Guardrail policy ${what(t)} was created.` }),
  "guardrail.updated": (t) => ({ title: "Guardrail updated", description: `Guardrail policy ${what(t)} was updated.` }),
  "guardrail.deleted": (t) => ({ title: "Guardrail deleted", description: `Guardrail policy ${what(t)} was deleted.` }),
  "guardrail.enabled": (t) => ({ title: "Guardrail enabled", description: `Guardrail policy ${what(t)} was enabled.` }),
  "guardrail.disabled": (t) => ({ title: "Guardrail disabled", description: `Guardrail policy ${what(t)} was disabled.` }),
  "guardrail.tested": (t) => ({ title: "Guardrail tested", description: `Guardrail policy ${what(t)} was test-run. No enforcement changed.` }),
};

/** True when the action has first-class copy (used for the "raw action"
 * affordance in tables — humanized fallbacks still show their raw id). */
export function isKnownAuditAction(action: string): boolean {
  return KNOWN[action] !== undefined || KNOWN[action.toLowerCase()] !== undefined;
}

/** Humanize a raw action id: "key.policy_updated" → "Key policy updated". */
export function humanizeAuditAction(action: string): string {
  const words = action.replace(/[.:]+/g, " ").replace(/_+/g, " ").trim().split(/\s+/);
  if (words.length === 0 || (words.length === 1 && words[0] === "")) return "Event";
  return words
    .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w.toLowerCase()))
    .join(" ");
}

/** Human title/description for an audit event. Unknown actions fall back to
 * a humanized title plus the raw id — never a bare "Unknown event". */
export function describeAuditEvent(action: string, target: Record<string, unknown>): AuditDescription {
  const t = target ?? {};
  const direct = KNOWN[action] ?? KNOWN[action.toLowerCase()];
  if (direct) return direct(t);
  return {
    title: humanizeAuditAction(action),
    description: `This event type isn't recognized by this client (raw action: ${action}). Raw details are shown below.`,
  };
}

/** Safe target rows for the detail drawer: redacted, primitives only. */
export function auditTargetRows(target: Record<string, unknown>): Array<{ key: string; value: string }> {
  return Object.entries(target ?? {})
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .slice(0, 24)
    .map(([k, v]) => ({ key: k, value: displayAuditValue(k, v) }));
}
