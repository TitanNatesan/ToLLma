# Public Sharing — Final Behavior (product decision: share the COMPLETE tree)

## Payload (`GET /public/{token}`, additive)
- Messages: full live set for the token's conversation (SYSTEM + soft-deleted
  excluded; `content == ""` exclusion waived for FAILED/CANCELLED so empty
  failed generations surface). Each carries `id, parent_message_id,
  version_number, status, error, error_code` plus safe display fields.
- `tree: {nodes[id,parent_message_id,role,version_number,status,created_at][],
  active_leaf_id}` — same DTO shape as the authenticated tree endpoint
  (minus SYSTEM nodes); `messages[].id ⟷ tree.nodes[].id` always join
  (single query, one visible set).
- Explicitly EXCLUDED (asserted absent in serialized JSON by test):
  `user_id, session_id, client_key, api_key_id`, raw `provider_id`/`model_id`
  (names only), all token counts, all costs, latency/ttfb/thinking timings,
  `usage_estimated`, `metadata_`, attachments, generation/version history,
  soft-delete markers, share tokens. Failed/cancelled nodes expose
  `error`/`error_code` strings only.

## Viewer experience (`app/share/[token]`)
- Full tree graph (reused `ConversationFlowGraph`, hook-free) + message list
  filtered to the locally selected valid path; owner's active path highlighted
  on load; request/response pagers drive LOCAL `useState` selection (default =
  owner's `active_leaf_id`) — the server leaf is never touched.
- Read-only: no composer, no regenerate/edit/branch/delete/retry-mutation
  controls; no mutation hooks reachable from the public route (static-contract
  tested). Zero mutation requests fire (intercept-asserted in e2e).

## Consent + lifecycle
- Share creation gated behind a confirmation dialog with the exact mandated
  warning text; Cancel aborts, Confirm mints. Expiry/revocation/view-count/
  cache semantics unchanged; revoked tokens 404.
- No redaction or deletion of history to implement sharing.

## Authorization
- Token-only lookup; single `conversation_id`-scoped query — cross-conversation/
  user/workspace leakage impossible. Authenticated intruders gain nothing.
  Unknown/revoked/expired → 404 per existing behavior.

## Tests (all PASS)
- Backend full suite 1334 passed + 1 pre-existing laya failure (contract test
  for payload shape/exclusions run throwaway: 1 passed).
- Frontend vitest 45 files / 372 (13 new: `pathToLeaf` 6 + static contracts 7).
- `e2e/public-share.spec.ts` 7/7 live (10-node seeded fixture, cleaned up):
  render, local-nav + zero-mutation, failed + hardening, warning cancel/
  confirm, revocation denial, desktop + mobile screenshots.
