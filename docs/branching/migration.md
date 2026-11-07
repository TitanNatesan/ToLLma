# Branching Conversations — Migration Report

- Revision `38aa765cebc8_conversation_tree` (single linear head on top of
  squashed `229b12f96076`). `alembic check` clean; live dev DB upgraded.
- Columns: `messages.parent_message_id` (UUID NULL, self-FK
  `fk_messages_parent_message`, SET NULL), `messages.version_number` (INT
  NOT NULL DEFAULT 1, `ck_messages_version_positive`, `ck_no_self_parent`),
  `conversations.active_leaf_message_id` (UUID NULL, `fk_conversations_active_leaf`,
  SET NULL, `use_alter`).
- Indexes: `ix_messages_parent`, `ix_messages_conv_parent`,
  `uq_messages_sibling_version` (NULL-roots caveat documented — Postgres
  NULL-distinct, roots service-sequenced), partial `ix_messages_roots`
  (`postgresql_where`, declared in metadata), `ix_conversations_active_leaf`.
- Backfill (IDs/timestamps preserved): LAG-chain parents in `(created_at,id)`
  order per conversation (matches `list_messages` canonical order, keeps the
  sibling unique satisfied); all `version_number=1` (no siblings existed);
  leaf = newest message per conversation. Verified: 16 msgs chained,
  0 self-parents, leaves set.
- Rollback: drops constraints/indexes/columns only. LOSSY-BY-DESIGN for tree
  structure (branch choices, sibling numbers, leaf) — row data (IDs, content,
  timestamps, usage/cost) fully preserved; re-upgrade re-derives the linear
  chain, post-upgrade branches collapse to linear order. Stated in migration
  docstring.
- Integrity: cross-conversation parents, cycles, ownership enforced at
  service layer (404-oracle); DB holds only row-local CHECKs (version>=1,
  no self-parent) to keep the hot insert path lock-free.
