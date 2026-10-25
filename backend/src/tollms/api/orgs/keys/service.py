"""Org key service — thin delegating wrapper (URL compatibility).

Canonical implementation lives in
``tollms.api.keys.organization_service``; this module only re-exports every
public name so existing importers (org routers, ``members``/``budgets``
services, ``api/orgs/service.py`` facade) keep working unchanged. New code
must import from the canonical module directly.
"""

from tollms.api.keys.organization_service import (
    active_org_ids,
    _org_key_select,
    _read_org_key,
    _allocated_budget,
    create_org_key,
    get_org_key,
    list_org_keys,
    revoke_org_key,
    _revoke_member_keys,
    update_org_key,
    put_org_key_policy,
    put_org_key_ip_rules,
    put_org_key_model_permissions,
    rotate_org_key,
)

__all__ = [
    'active_org_ids',
    '_org_key_select',
    '_read_org_key',
    '_allocated_budget',
    'create_org_key',
    'get_org_key',
    'list_org_keys',
    'revoke_org_key',
    '_revoke_member_keys',
    'update_org_key',
    'put_org_key_policy',
    'put_org_key_ip_rules',
    'put_org_key_model_permissions',
    'rotate_org_key',
]
