"""Org audit event registry: human titles for every known audit action.

Leaf module — imports stdlib only. The audit list service enriches rows
with ``display_title`` from here (additive field); unknown actions fall
back to a humanized title so the UI never shows "Unknown event".
"""


def _ev(title: str, description: str, resource_type: str, category: str,
        security_sensitive: bool = False) -> dict:
    return {
        "title": title,
        "description": description,
        "resource_type": resource_type,
        "category": category,
        "security_sensitive": security_sensitive,
    }


EVENT_REGISTRY: dict[str, dict] = {
    # --- organization ----------------------------------------------------
    "org.created": _ev(
        "Organization created", "The organization was created.",
        "organization", "organization"),
    "org.updated": _ev(
        "Organization updated", "Organization profile fields were updated.",
        "organization", "organization"),
    # --- members ----------------------------------------------------------
    "member.invited": _ev(
        "Member invited", "An invitation was sent to a new member.",
        "member", "members", security_sensitive=True),
    "member.accepted": _ev(
        "Invitation accepted", "An invited user joined the organization.",
        "member", "members"),
    "member.rejected_invite": _ev(
        "Invitation declined", "An invited user declined to join.",
        "member", "members"),
    "member.requested": _ev(
        "Join requested", "A user requested to join the organization.",
        "member", "members"),
    "member.approved": _ev(
        "Join request approved", "A join request was approved.",
        "member", "members", security_sensitive=True),
    "member.request_rejected": _ev(
        "Join request rejected", "A join request was rejected.",
        "member", "members"),
    "member.suspended": _ev(
        "Member suspended", "A member's access was suspended.",
        "member", "members", security_sensitive=True),
    "member.resumed": _ev(
        "Member resumed", "A suspended member was reactivated.",
        "member", "members", security_sensitive=True),
    "member.removed": _ev(
        "Member removed", "A member was removed from the organization.",
        "member", "members", security_sensitive=True),
    "member.left": _ev(
        "Member left", "A member left the organization.",
        "member", "members"),
    # --- invitations -------------------------------------------------------
    "invite.expired": _ev(
        "Invitation expired", "A pending invitation expired.",
        "invitation", "members", security_sensitive=True),
    "invite.resent": _ev(
        "Invitation resent", "An invitation was resent with a fresh token.",
        "invitation", "members", security_sensitive=True),
    "invite.revoked": _ev(
        "Invitation revoked", "A pending invitation was revoked.",
        "invitation", "members", security_sensitive=True),
    # --- teams --------------------------------------------------------------
    "team.created": _ev(
        "Team created", "A team was created.",
        "team", "teams"),
    "team.updated": _ev(
        "Team updated", "A team was renamed or edited.",
        "team", "teams"),
    "team.deleted": _ev(
        "Team deleted", "A team was deleted.",
        "team", "teams", security_sensitive=True),
    "team.member_added": _ev(
        "Team member added", "A member was added to a team.",
        "team", "teams"),
    "team.member_removed": _ev(
        "Team member removed", "A member was removed from a team.",
        "team", "teams"),
    "team.sets_assigned": _ev(
        "Team permission sets assigned", "A team's permission sets changed.",
        "team", "teams", security_sensitive=True),
    # --- permission sets ------------------------------------------------------
    "set.created": _ev(
        "Permission set created", "A permission set was created.",
        "permission_set", "permissions"),
    "set.updated": _ev(
        "Permission set updated", "A permission set was updated.",
        "permission_set", "permissions"),
    "set.deleted": _ev(
        "Permission set deleted", "A permission set was deleted.",
        "permission_set", "permissions", security_sensitive=True),
    "set.assigned": _ev(
        "Permission set assigned", "Permission sets were assigned to a member.",
        "permission_set", "permissions", security_sensitive=True),
    # --- budgets ---------------------------------------------------------------
    "budget.cap_changed": _ev(
        "Budget cap changed", "The organization spend cap changed.",
        "budget", "budgets", security_sensitive=True),
    # --- providers / models -----------------------------------------------------
    "provider.created": _ev(
        "Provider created", "An organization provider was added.",
        "provider", "providers", security_sensitive=True),
    "provider.updated": _ev(
        "Provider updated", "An organization provider was updated.",
        "provider", "providers", security_sensitive=True),
    "provider.deleted": _ev(
        "Provider deleted", "An organization provider was deleted.",
        "provider", "providers", security_sensitive=True),
    "model.created": _ev(
        "Model registered", "A model was registered on an org provider.",
        "model", "providers"),
    "model.updated": _ev(
        "Model updated", "An organization model was updated.",
        "model", "providers"),
    "model.deleted": _ev(
        "Model deleted", "An organization model was deleted.",
        "model", "providers"),
    # --- api keys -----------------------------------------------------------------
    "key.issued": _ev(
        "API key issued", "An organization API key was issued.",
        "api_key", "keys", security_sensitive=True),
    "key.revoked": _ev(
        "API key revoked", "An organization API key was revoked.",
        "api_key", "keys", security_sensitive=True),
    "key.updated": _ev(
        "API key updated", "An organization API key's metadata changed.",
        "api_key", "keys", security_sensitive=True),
    "key.policy_updated": _ev(
        "API key policy updated", "An organization API key's policy changed.",
        "api_key", "keys", security_sensitive=True),
    "key.ip_rules_updated": _ev(
        "API key IP rules updated", "An organization API key's IP rules changed.",
        "api_key", "keys", security_sensitive=True),
    "key.models_updated": _ev(
        "API key models updated", "An organization API key's model access changed.",
        "api_key", "keys", security_sensitive=True),
    "key.rotated": _ev(
        "API key rotated", "An organization API key was rotated.",
        "api_key", "keys", security_sensitive=True),
    # --- prompt logs -----------------------------------------------------------------
    "prompt_logs.log.delete": _ev(
        "Prompt log deleted", "A prompt log entry was deleted.",
        "prompt_log", "prompt_logs", security_sensitive=True),
    "prompt_logs.purge": _ev(
        "Prompt logs purged", "Expired prompt log content was purged.",
        "prompt_log", "prompt_logs", security_sensitive=True),
    "prompt_logs.settings.update": _ev(
        "Prompt logging settings updated", "Prompt logging settings changed.",
        "prompt_log", "prompt_logs", security_sensitive=True),
    # --- conversations ------------------------------------------------------------------
    "conversation.deleted": _ev(
        "Conversation deleted", "A conversation was deleted.",
        "conversation", "conversations"),
}


def format_event(action: str | None) -> str:
    """Human title for an audit action. Known actions use the registry;
    anything else is humanized (never "Unknown event")."""
    if action and action in EVENT_REGISTRY:
        return EVENT_REGISTRY[action]["title"]
    text = (action or "").replace("_", " ").replace(".", " ").replace("-", " ").strip()
    if not text:
        return "Event"
    return " ".join(word[:1].upper() + word[1:] for word in text.split())
