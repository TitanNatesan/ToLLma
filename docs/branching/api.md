# Branching Conversations — API Report

## Reused endpoints (behavior extended, paths/methods/status unchanged)
- `POST /api/v1/conversations`, `GET /list/{id}/messages/usage/active-generation`,
  `PATCH rename/pin`, `DELETE`, branch fork `GET/POST .../branches` — untouched.
- `PATCH /api/v1/messages/{id}?key_id=` — now creates a new user sibling +
  assistant child (branching edit) instead of snapshot+replace; key gate runs
  BEFORE any mutation. Same response shape + `regeneration_started` contract.
- `POST /api/v1/messages/{id}/regenerate` — now spawns a NEW assistant sibling
  row (RUNNING → driver finalizes that row); old rows + their runs untouched.
- `POST .../generations/{run_id}/activate`, `GET .../history|generations`,
  `DELETE /api/v1/messages/{id}` (now retargets active leaf) — compatible.
- Gateway `.../chat|stream|stream/{id}|cancel|by-client-key|{id}` — same
  contract; `_history`/`_history_until` now built from the active path.
- `MessageRead` += `parent_message_id`, `version_number` (additive);
  `ConversationRead` += `active_leaf_message_id` (additive).

## New endpoints
- `GET /api/v1/conversations/{id}/tree` → `ConversationTreeRead{nodes:
  TreeNodeRead[id,parent_message_id,role,version_number,status,created_at][],
  active_leaf_id}`
- `GET /api/v1/conversations/{id}/path` → `ConversationPathRead{path:
  MessageRead[] root→leaf, active_leaf_id}`
- `POST /api/v1/conversations/{id}/select {message_id}` → `ConversationPathRead`
  (sets leaf; 404 on foreign/deleted/other-conversation nodes)
- `GET /api/v1/messages/{id}/siblings` → `MessageRead[]` (version order)
- `GET /api/v1/messages/{id}/children` → `MessageRead[]` (version order)
- All new routes use unique function names (zero duplicate operationIds across
  305 routes); `siblings`/`children` carry explicit `operation_id=` params.
- Backwards-compatible: new `MessageRead`/`ConversationRead` fields are
  optional/defaulted; frontend tolerates omission (404-tolerant hooks).

## Authorization
- Every new endpoint threads `user.id`; cross-owner reads are 404 (never 403,
  no existence oracle). Cross-conversation parents/cutoffs are 404
  (`NotFoundError`). Edit/regenerate key gates unchanged and run pre-mutation.
