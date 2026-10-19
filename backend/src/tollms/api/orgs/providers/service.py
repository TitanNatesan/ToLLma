"""Org provider service — thin delegating wrapper (URL compatibility).

Canonical implementation lives in
``tollms.api.providers.organization_service``; this module only re-exports
every public name so existing importers (org routers, ``api/orgs/service.py``
facade) keep working unchanged. New code must import from the canonical
module directly.
"""

from tollms.api.providers.organization_service import (
    create_org_provider,
    register_org_provider,
    list_org_providers,
    list_org_provider_models,
    list_org_models,
    update_org_provider,
    delete_org_provider,
)

__all__ = [
    'create_org_provider',
    'register_org_provider',
    'list_org_providers',
    'list_org_provider_models',
    'list_org_models',
    'update_org_provider',
    'delete_org_provider',
]
