"""Organizations service facade (deprecated-internal compat layer).

The implementation moved to per-domain ``service.py`` modules
(``common/``, ``overview/``, ``permissions/``, ...). This module only
re-exports every public name so existing lazy importers
(``providers/service.py``, ``models/service.py``) keep working unchanged.
New code must import from the domain modules directly.
Target removal: v0.2 — once the lazy importers import
``tollms.api.orgs.common.guards`` directly.
"""

from tollms.api.orgs.common.guards import (
    PERMISSION_GROUPS,
    PERMISSION_CATALOG,
    PERMISSION_LABELS,
    SYSTEM_SET_DEFS,
    _ORG_NOT_FOUND,
    _VALID_STATES,
    _VALID_KINDS,
    _VALID_STATUSES,
    _MAX_PAGE,
    _set_codes,
    _clamp_limit,
    _clamp_offset,
    _search_like,
    _parse_uuid,
    _parse_time,
    _live_membership,
    _any_membership,
    effective_permissions,
    _get_org,
    _member_org,
    _require_perm,
    _check_grantable,
    _resolve_sets,
)

from tollms.api.orgs.common.audit import (
    _audit,
    _notify,
)

from tollms.api.orgs.overview.service import (
    ensure_system_sets,
    permission_catalog,
    _read_org,
    _slugify,
    create_organization,
    list_my_organizations,
    search_organizations,
    update_organization,
    _notify_members_policy_change,
)

from tollms.api.orgs.permissions.service import (
    _read_set,
    list_sets,
    create_set,
    update_set,
    delete_set,
    clone_set,
    assign_sets,
)

from tollms.api.orgs.teams.service import (
    _parse_include,
    _get_team,
    _team_codes,
    _read_team,
    _reject_system_sets,
    create_team,
    list_teams,
    get_team,
    update_team,
    delete_team,
    add_team_member,
    remove_team_member,
    set_team_sets,
)

from tollms.api.orgs.members.service import (
    _read_members_batch,
    read_member,
    list_members,
    suspend_member,
    resume_member,
    remove_member,
    leave_organization,
)

from tollms.api.orgs.invitations.service import (
    _expire_due,
    _find_user_by_email,
    _invite_link,
    _send_invite_email,
    invite_user,
    _approver_ids,
    _set_summaries,
    _read_invitation,
    list_invitations,
    my_invitations,
    _load_token,
    _activate_membership,
    accept_invitation,
    reject_invitation,
    resend_invitation,
    cancel_invitation,
    preview_invitation,
    _INVITE_NOT_FOUND,
    InviteAccountExistsError,
    _load_public_invitation,
    _live_invite_set_ids,
    accept_new_invitation,
    reject_new_invitation,
)

from tollms.api.orgs.requests.service import (
    request_join,
    list_requests,
    approve_request,
    reject_request,
)

from tollms.api.orgs.audit.service import (
    get_audit,
)

from tollms.api.orgs.keys.service import (
    active_org_ids,
    _org_key_select,
    _read_org_key,
    _allocated_budget,
    create_org_key,
    list_org_keys,
    revoke_org_key,
    _revoke_member_keys,
)

from tollms.api.orgs.providers.service import (
    create_org_provider,
    register_org_provider,
    list_org_providers,
    list_org_provider_models,
    list_org_models,
    update_org_provider,
    delete_org_provider,
)

from tollms.api.orgs.budgets.service import (
    get_budget,
    set_budget_cap,
)

from tollms.api.orgs.analytics.service import (
    org_analytics_overview,
)

__all__ = ['PERMISSION_GROUPS', 'PERMISSION_CATALOG', 'PERMISSION_LABELS', 'SYSTEM_SET_DEFS', '_ORG_NOT_FOUND', '_VALID_STATES', '_VALID_KINDS', '_VALID_STATUSES', '_MAX_PAGE', '_set_codes', '_clamp_limit', '_clamp_offset', '_search_like', '_parse_uuid', '_parse_time', '_live_membership', '_any_membership', 'effective_permissions', '_get_org', '_member_org', '_require_perm', '_check_grantable', '_resolve_sets', '_audit', '_notify', 'ensure_system_sets', 'permission_catalog', '_read_org', '_slugify', 'create_organization', 'list_my_organizations', 'search_organizations', 'update_organization', '_notify_members_policy_change', '_read_set', 'list_sets', 'create_set', 'update_set', 'delete_set', 'clone_set', 'assign_sets', '_parse_include', '_get_team', '_team_codes', '_read_team', '_reject_system_sets', 'create_team', 'list_teams', 'get_team', 'update_team', 'delete_team', 'add_team_member', 'remove_team_member', 'set_team_sets', '_read_members_batch', 'read_member', 'list_members', 'suspend_member', 'resume_member', 'remove_member', 'leave_organization', '_expire_due', '_find_user_by_email', '_invite_link', '_send_invite_email', 'invite_user', '_approver_ids', '_set_summaries', '_read_invitation', 'list_invitations', 'my_invitations', '_load_token', '_activate_membership', 'accept_invitation', 'reject_invitation', 'resend_invitation', 'cancel_invitation', 'preview_invitation', '_INVITE_NOT_FOUND', 'InviteAccountExistsError', '_load_public_invitation', '_live_invite_set_ids', 'accept_new_invitation', 'reject_new_invitation', 'request_join', 'list_requests', 'approve_request', 'reject_request', 'get_audit', 'active_org_ids', '_org_key_select', '_read_org_key', '_allocated_budget', 'create_org_key', 'list_org_keys', 'revoke_org_key', '_revoke_member_keys', 'create_org_provider', 'register_org_provider', 'list_org_providers', 'list_org_provider_models', 'list_org_models', 'update_org_provider', 'delete_org_provider', 'get_budget', 'set_budget_cap', 'org_analytics_overview']