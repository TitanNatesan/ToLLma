# Branching Conversations — Architecture Report

## Final tree model
- Every message row is a version node: `messages.parent_message_id` (self-FK,
  `SET NULL`, NULL = root, multiple roots allowed), `messages.version_number`
  (position within the sibling family, `>= 1`, unique per
  `(conversation_id, parent_message_id, version_number)` for non-root families;
  roots are service-sequenced since Postgres treats NULLs as distinct).
- Node type reuses `messages.role` (`user_request` = USER, `ai_response` =
  ASSISTANT; SYSTEM exempt from alternation checks). Lifecycle reuses
  `messages.status` (QUEUED/RUNNING/COMPLETED/CANCELLED/FAILED).
- `conversations.active_leaf_message_id` persists the selected path tip.
  The active path is derived by walking `parent_message_id` to the root —
  there is no independently mutable visible-message array.

## Node relationships
- `Message.parent` / `Message.children` (`remote_side`, `order_by
  version_number`, `save-update,merge`, no delete-orphan matching SET NULL).
- `Conversation.active_leaf` (`post_update`, `noload`, `use_alter` circular FK
  exactly like the existing `branch_from_message_id` pattern).
- Fork-level `parent_conversation_id` branching is orthogonal and untouched.

## Version semantics / branching rules
- Rule A (regenerate): NEW assistant sibling under the same user request;
  prior siblings (incl. FAILED/CANCELLED) untouched; new `generation_runs`
  attach to the new row starting at 1.
- Rule B (edit request): NEW user sibling under the same parent as the edited
  node (preceding response, or NULL root for first-request edits → Rule E
  multi-root), then a new assistant child; active leaf follows the new child.
  No `message_versions` snapshots for branch edits (the node itself is new).
- Rules C/D (switching): `POST .../select {message_id}` sets the leaf after
  same-conversation + ownership validation; descendants come from the
  parent-chain walk, so unrelated branches never leak into the visible path.
- New sends parent to the current active leaf (never an inactive branch).

## Active-path selection & persistence
- Single nullable leaf per conversation (ownership is per-conversation via
  `user_id`, so no per-user table needed). Survives refresh/reopen/navigate
  (server-side, scoped to conversation + user). Delete retargets the leaf to
  nearest live ancestor → newest live message → NULL. Stale/foreign/deleted
  selections 404 and never repoint.

## Persistence & migration
- Additive migration `38aa765cebc8` on top of squashed head `229b12f96076`:
  nullable-first column adds, LAG-chain backfill in `(created_at,id)` order,
  `version_number=1`, leaf = newest message, then NOT NULL/defaults.
  Downgrade drops tree structure only (rows preserved; lossy-by-design,
  stated in docstring).
- `message_versions` / `generation_runs` stay as per-node history (different
  grain: snapshots/attempts of ONE node, not sibling nodes) — reusing them
  would break attachments, search index, `ix_one_active_assistant`, and
  `client_key` idempotency keyed on `messages.id`.

## Concurrency
- `conv_lock` + `ix_one_active_assistant` + `client_key` adopt paths extended
  to sibling-row creation. Sibling-version races map ONLY
  `uq_messages_sibling_version` violations to 409 `ConflictError` (other
  `IntegrityError`s re-raise raw — the live-assistant backstop test pins
  this). Leaf advances only after successful flush (no orphans). Model
  context is built from the active path, never the full log (media reference
  lookup included).
