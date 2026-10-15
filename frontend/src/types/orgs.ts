export interface Organization {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  website: string | null;
  industry: string | null;
  location: string | null;
  size: string | null;
  status: string;
  visibility_mode: string;
  personal_sharing_enforced: boolean;
  is_root: boolean;
  permissions: string[];
  created_at: string;
}

export interface OrgCard {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  website: string | null;
  industry: string | null;
}

export interface PermissionSet {
  id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  permissions: string[];
  created_at: string;
}

export interface Invitation {
  id: string;
  org_id: string;
  org_name: string;
  org_slug: string;
  email: string;
  kind: "invite" | "request";
  status: "pending" | "accepted" | "rejected" | "expired" | "closed";
  expires_at: string;
  /** Phase B: enriched to carry inviter identity (object) or legacy UUID string. */
  invited_by: string | { name?: string | null; email?: string | null } | null;
  set_ids: string[];
  created_at: string;
  /** Single-use secret; present only on the recipient's own queue. */
  token?: string | null;
  /** Phase B enrichment (optional until the backend ships it): inviter display fields. */
  invited_by_name?: string | null;
  invited_by_email?: string | null;
  inviter?: { name?: string | null; email?: string | null } | null;
  /** Phase B enrichment: granted sets with their permission codes. */
  permission_sets?: Array<string | { name: string; codes?: string[]; permissions?: string[] }>;
  set_names?: string[];
  set_details?: Array<{ name: string; codes?: string[]; permissions?: string[] }>;
}

export interface Member {
  user_id: string;
  email: string;
  is_root: boolean;
  state: string;
  permission_sets: string[];
  permissions: string[];
}

export interface AuditEntry {
  id: string;
  action: string;
  actor_user_id: string | null;
  target: Record<string, unknown>;
  created_at: string;
}

export interface Notification {
  id: string;
  org_id: string | null;
  kind: string;
  title: string;
  body: string | null;
  ref: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

export interface PermissionGroup {
  group: string;
  permissions: { code: string; label: string }[];
}

/** Fallback catalog (server `/permissions/catalog` is authoritative). */
export const PERMISSION_GROUPS: PermissionGroup[] = [
  { group: "Organization", permissions: [
    { code: "Organization.Read", label: "View organization" },
    { code: "Organization.Update", label: "Update organization profile" },
    { code: "Organization.Delete", label: "Delete organization" },
    { code: "Organization.TransferRoot", label: "Transfer root ownership" },
    { code: "Organization.Settings", label: "Manage organization settings" },
    { code: "Organization.ViewAnalytics", label: "View organization analytics" },
    { code: "Organization.ViewAudit", label: "View audit log" },
  ] },
  { group: "Members", permissions: [
    { code: "Members.Invite", label: "Invite members" },
    { code: "Members.Approve", label: "Approve requests" },
    { code: "Members.Read", label: "View members" },
    { code: "Members.Update", label: "Update members" },
    { code: "Members.Suspend", label: "Suspend members" },
    { code: "Members.Remove", label: "Remove members" },
    { code: "Members.Export", label: "Export members" },
  ] },
  { group: "Teams", permissions: [
    { code: "Teams.Create", label: "Create teams" },
    { code: "Teams.Read", label: "View teams" },
    { code: "Teams.Update", label: "Update teams" },
    { code: "Teams.Delete", label: "Delete teams" },
    { code: "Teams.AssignMembers", label: "Assign team members" },
    { code: "Teams.RemoveMembers", label: "Remove team members" },
    { code: "Teams.AssignPermissionSets", label: "Assign team permission sets" },
  ] },
  { group: "Permission Sets", permissions: [
    { code: "PermissionSets.Create", label: "Create permission sets" },
    { code: "PermissionSets.Read", label: "View permission sets" },
    { code: "PermissionSets.Update", label: "Update permission sets" },
    { code: "PermissionSets.Delete", label: "Delete permission sets" },
    { code: "PermissionSets.Assign", label: "Assign permission sets" },
  ] },
  { group: "Providers", permissions: [
    { code: "Providers.Create", label: "Create providers" },
    { code: "Providers.Read", label: "View providers" },
    { code: "Providers.Update", label: "Update providers" },
    { code: "Providers.Delete", label: "Delete providers" },
    { code: "Providers.Validate", label: "Validate providers" },
    { code: "Providers.RefreshModels", label: "Refresh provider models" },
    { code: "Providers.ViewCredentials", label: "View provider credentials" },
    { code: "Providers.RotateCredentials", label: "Rotate provider credentials" },
  ] },
  { group: "Keys", permissions: [
    { code: "Keys.Create", label: "Create API keys" },
    { code: "Keys.Read", label: "View API keys" },
    { code: "Keys.Update", label: "Update API keys" },
    { code: "Keys.Delete", label: "Delete API keys" },
    { code: "Keys.Revoke", label: "Revoke API keys" },
    { code: "Keys.Assign", label: "Assign API keys" },
    { code: "Keys.Rotate", label: "Rotate API keys" },
  ] },
  { group: "Budgets", permissions: [
    { code: "Budgets.Read", label: "View budgets" },
    { code: "Budgets.Update", label: "Update budgets" },
    { code: "Budgets.Allocate", label: "Allocate budgets" },
    { code: "Budgets.Reclaim", label: "Reclaim budgets" },
  ] },
  { group: "Analytics", permissions: [
    { code: "Analytics.ViewUsage", label: "View usage analytics" },
    { code: "Analytics.ViewCost", label: "View cost analytics" },
    { code: "Analytics.Export", label: "Export analytics" },
    { code: "Analytics.ViewConversations", label: "View conversations" },
    { code: "Analytics.ViewAttachments", label: "View attachments" },
  ] },
  { group: "Audit", permissions: [
    { code: "Audit.Read", label: "Read audit log" },
    { code: "Audit.Export", label: "Export audit log" },
  ] },
];

// --- Phase B: org keys / providers / budgets / analytics / invite preview ---

/** Organization API key read (never carries the secret). Field names are
 * tolerant: the parallel backend may use snake_case variants. */
export interface OrgKey {
  id: string;
  name: string;
  description?: string | null;
  assignee_user_id?: string | null;
  assignee_email?: string | null;
  /** Alternate backend namings for the assignee identity. */
  user_id?: string | null;
  email?: string | null;
  user_email?: string | null;
  max_budget_usd?: number | string | null;
  max_budget?: number | string | null;
  budget_usd?: number | string | null;
  budget?: number | string | null;
  model_permissions?: unknown;
  model_ids?: string[] | null;
  models?: string[] | Array<{ id?: string; name?: string }> | null;
  model_count?: number | null;
  key_prefix?: string | null;
  masked?: string | null;
  revoked?: boolean | null;
  created_at: string;
}

export interface OrgKeyCreateInput {
  assignee_user_id: string;
  name: string;
  description?: string;
  max_budget_usd?: number | null;
  model_permissions?: Array<{ model_id: string; provider_id?: string }>
}

/** Create response: the raw secret appears exactly once. */
export interface OrgKeySecretResponse {
  raw_key: string;
  key?: OrgKey;
  id?: string;
  name?: string;
}

/** Organization provider read. Mirrors the personal Provider shape. */
export interface OrgProvider {
  id: string;
  name: string;
  provider_type?: string;
  type?: string;
  validation_status?: string;
  status?: string;
  validation_message?: string | null;
  message?: string | null;
  credentials_masked?: Record<string, string>;
  credentials?: Record<string, string>;
  is_active?: boolean;
  last_validated_at?: string | null;
  created_at?: string;
}

export interface OrgProviderCreateInput {
  name: string;
  provider_type: string;
  credentials: Record<string, unknown>;
  catalog_slug?: string | null;
}

export interface OrgBudget {
  max_spend?: number | string | null;
  max_budget_usd?: number | string | null;
  cap?: number | string | null;
  allocated?: number | string | null;
  unallocated?: number | string | null;
  currency?: string | null;
}

export interface OrgAnalyticsRow {
  id?: string;
  key?: string;
  name?: string;
  label?: string;
  model?: string;
  provider?: string;
  email?: string;
  user_email?: string;
  user_id?: string;
  requests?: number | string | null;
  total_requests?: number | string | null;
  tokens?: number | string | null;
  total_tokens?: number | string | null;
  cost?: number | string | null;
  total_cost?: number | string | null;
  spend?: number | string | null;
  removed?: boolean | null;
  removed_badge?: boolean | null;
  is_removed?: boolean | null;
  member_removed?: boolean | null;
}

/** GET /orgs/{id}/analytics/overview. Cost is null without ViewCost. */
export interface OrgAnalyticsOverview {
  requests?: number | string | null;
  total_requests?: number | string | null;
  tokens?: number | string | null;
  total_tokens?: number | string | null;
  cost?: number | string | null;
  total_cost?: number | string | null;
  spend?: number | string | null;
  cost_restricted?: boolean | null;
  by_model?: OrgAnalyticsRow[];
  models?: OrgAnalyticsRow[];
  by_provider?: OrgAnalyticsRow[];
  providers?: OrgAnalyticsRow[];
  by_user?: OrgAnalyticsRow[];
  users?: OrgAnalyticsRow[];
  by_member?: OrgAnalyticsRow[];
  members?: OrgAnalyticsRow[];
}

export interface InvitePreviewSet {
  name: string;
  codes?: string[];
  permissions?: string[];
}

export interface InvitePreview {
  org_name: string;
  org_slug?: string | null;
  email: string;
  invited_by?: { name?: string | null; email?: string | null } | string | null;
  inviter?: { name?: string | null; email?: string | null } | null;
  invited_by_name?: string | null;
  invited_by_email?: string | null;
  permission_sets?: InvitePreviewSet[];
  sets?: InvitePreviewSet[];
  expires_at?: string | null;
}

// --- Teams (parallel backend; shapes stay tolerant until the contract lands) ---

export interface TeamMember {
  membership_id: string;
  user_id: string;
  email: string;
  full_name?: string | null;
  state: string;
}

export interface TeamSetRef {
  id: string;
  name: string;
  codes: string[];
}

/** Team read. List rows may omit members/sets; detail carries the full shape. */
export interface Team {
  id: string;
  org_id: string;
  name: string;
  description?: string | null;
  member_count: number;
  members?: TeamMember[];
  sets?: TeamSetRef[];
  /** Union of effective permission codes across assigned sets. */
  codes: string[];
  created_at: string;
  updated_at?: string;
}

export interface TeamCreateInput {
  name: string;
  description?: string;
  set_ids?: string[];
}
