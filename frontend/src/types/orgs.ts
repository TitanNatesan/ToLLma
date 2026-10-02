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
  invited_by: string | null;
  set_ids: string[];
  created_at: string;
  /** Single-use secret; present only on the recipient's own queue. */
  token?: string | null;
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
