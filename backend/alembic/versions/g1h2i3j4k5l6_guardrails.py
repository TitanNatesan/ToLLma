"""Guardrails: policies, rules, evaluator configs, assignments, triggers."""

revision: str = "g1h2i3j4k5l6"
down_revision: str | None = "e4f1a2b3c4d5"
branch_labels: str | list[str] | None = None
depends_on: str | list[str] | None = None


def upgrade() -> None:
    from alembic import op
    import sqlalchemy as sa
    from sqlalchemy.dialects import postgresql

    op.create_table(
        "guardrail_policies",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("severity", sa.String(16), nullable=False, server_default="medium"),
        sa.Column("enforcement", sa.String(16), nullable=False, server_default="warn"),
        sa.Column("stage", sa.String(8), nullable=False, server_default="both"),
        sa.Column("delivery_mode", sa.String(32), nullable=False, server_default="audit_after_delivery"),
        sa.Column("log_triggers", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("notify_on_trigger", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("failure_action", sa.String(8), nullable=False, server_default="allow"),
        sa.Column("confidence_threshold", sa.Float(), nullable=True),
        sa.Column("evaluator_timeout_ms", sa.Integer(), nullable=False, server_default="5000"),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("is_template", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_guardrail_policies_org", "guardrail_policies", ["org_id"])
    op.create_index("ix_guardrail_policies_user", "guardrail_policies", ["user_id"])
    op.create_index("ix_guardrail_policies_created", "guardrail_policies", ["created_at"])
    op.create_index("ix_guardrail_policies_enabled", "guardrail_policies", ["is_enabled"])
    op.create_index("ix_guardrail_policies_template", "guardrail_policies", ["is_template"])
    op.create_index(
        "uq_guardrail_policies_personal_name_live", "guardrail_policies", ["user_id", "name"],
        unique=True, postgresql_where=sa.text("is_deleted = false AND org_id IS NULL"),
    )
    op.create_index(
        "uq_guardrail_policies_org_name_live", "guardrail_policies", ["org_id", "name"],
        unique=True, postgresql_where=sa.text("is_deleted = false AND org_id IS NOT NULL"),
    )

    op.create_table(
        "guardrail_rules",
        sa.Column("policy_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("guardrail_policies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("category", sa.String(32), nullable=False),
        sa.Column("severity", sa.String(16), nullable=False, server_default="medium"),
        sa.Column("config", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_guardrail_rules_policy", "guardrail_rules", ["policy_id"])
    op.create_index("ix_guardrail_rules_created", "guardrail_rules", ["created_at"])

    op.create_table(
        "guardrail_evaluator_configs",
        sa.Column("policy_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("guardrail_policies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("evaluator_type", sa.String(32), nullable=False),
        sa.Column("provider_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("providers.id", ondelete="SET NULL"), nullable=True),
        sa.Column("model_ref", sa.String(255), nullable=True),
        sa.Column("credentials_encrypted", sa.Text(), nullable=True),
        sa.Column("operation", sa.String(64), nullable=True),
        sa.Column("timeout_ms", sa.Integer(), nullable=True),
        sa.Column("threshold", sa.Float(), nullable=True),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_guardrail_evaluator_configs_policy", "guardrail_evaluator_configs", ["policy_id"])
    op.create_index("ix_guardrail_evaluator_configs_provider", "guardrail_evaluator_configs", ["provider_id"])
    op.create_index("ix_guardrail_evaluator_configs_created", "guardrail_evaluator_configs", ["created_at"])

    op.create_table(
        "guardrail_assignments",
        sa.Column("policy_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("guardrail_policies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("scope_type", sa.String(16), nullable=False, server_default="global"),
        sa.Column("provider_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("providers.id", ondelete="CASCADE"), nullable=True),
        sa.Column("model_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("models.id", ondelete="CASCADE"), nullable=True),
        sa.Column("api_key_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("api_keys.id", ondelete="CASCADE"), nullable=True),
        sa.Column("applies_internal", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("applies_external", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_guardrail_assignments_policy", "guardrail_assignments", ["policy_id"])
    op.create_index("ix_guardrail_assignments_provider", "guardrail_assignments", ["provider_id"])
    op.create_index("ix_guardrail_assignments_model", "guardrail_assignments", ["model_id"])
    op.create_index("ix_guardrail_assignments_key", "guardrail_assignments", ["api_key_id"])
    op.create_index("ix_guardrail_assignments_created", "guardrail_assignments", ["created_at"])

    op.create_table(
        "guardrail_triggers",
        sa.Column("policy_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("guardrail_policies.id", ondelete="SET NULL"), nullable=True),
        sa.Column("policy_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("workspace_type", sa.String(16), nullable=False, server_default="personal"),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True),
        sa.Column("request_id", sa.String(128), nullable=True),
        sa.Column("generation_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("endpoint", sa.String(64), nullable=True),
        sa.Column("source", sa.String(16), nullable=False, server_default="internal"),
        sa.Column("api_key_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("api_keys.id", ondelete="SET NULL"), nullable=True),
        sa.Column("provider_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("providers.id", ondelete="SET NULL"), nullable=True),
        sa.Column("model_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("models.id", ondelete="SET NULL"), nullable=True),
        sa.Column("evaluator_type", sa.String(32), nullable=True),
        sa.Column("stage", sa.String(8), nullable=True),
        sa.Column("category", sa.String(32), nullable=True),
        sa.Column("severity", sa.String(16), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.Column("enforcement", sa.String(16), nullable=True),
        sa.Column("action", sa.String(24), nullable=False, server_default="allowed"),
        sa.Column("reason", sa.String(500), nullable=True),
        sa.Column("latency_ms", sa.Float(), nullable=True),
        sa.Column("notified", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("failure_kind", sa.String(64), nullable=True),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_guardrail_triggers_policy", "guardrail_triggers", ["policy_id"])
    op.create_index("ix_guardrail_triggers_org", "guardrail_triggers", ["org_id"])
    op.create_index("ix_guardrail_triggers_user", "guardrail_triggers", ["user_id"])
    op.create_index("ix_guardrail_triggers_created", "guardrail_triggers", ["created_at"])
    op.create_index("ix_guardrail_triggers_action", "guardrail_triggers", ["action"])
    op.create_index("ix_guardrail_triggers_severity", "guardrail_triggers", ["severity"])
    op.create_index("ix_guardrail_triggers_provider", "guardrail_triggers", ["provider_id"])
    op.create_index("ix_guardrail_triggers_key", "guardrail_triggers", ["api_key_id"])


def downgrade() -> None:
    from alembic import op

    for table, indexes in [
        ("guardrail_triggers", ["ix_guardrail_triggers_policy", "ix_guardrail_triggers_org",
                                "ix_guardrail_triggers_user", "ix_guardrail_triggers_created",
                                "ix_guardrail_triggers_action", "ix_guardrail_triggers_severity",
                                "ix_guardrail_triggers_provider", "ix_guardrail_triggers_key"]),
        ("guardrail_assignments", ["ix_guardrail_assignments_policy", "ix_guardrail_assignments_provider",
                                  "ix_guardrail_assignments_model", "ix_guardrail_assignments_key",
                                  "ix_guardrail_assignments_created"]),
        ("guardrail_evaluator_configs", ["ix_guardrail_evaluator_configs_policy",
                                        "ix_guardrail_evaluator_configs_provider",
                                        "ix_guardrail_evaluator_configs_created"]),
        ("guardrail_rules", ["ix_guardrail_rules_policy", "ix_guardrail_rules_created"]),
        ("guardrail_policies", ["ix_guardrail_policies_org", "ix_guardrail_policies_user",
                               "ix_guardrail_policies_created", "ix_guardrail_policies_enabled",
                               "ix_guardrail_policies_template",
                               "uq_guardrail_policies_personal_name_live",
                               "uq_guardrail_policies_org_name_live"]),
    ]:
        for index in indexes:
            op.drop_index(index, table_name=table)
        op.drop_table(table)
