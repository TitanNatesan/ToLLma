# Database Rules

Use:

- PostgreSQL
- SQLAlchemy 2.x
- Alembic

---

All tables must include:

created_at
updated_at

---

Business tables:

is_deleted
deleted_at
deleted_by

---

Use UUID primary keys.

---

Relationships must be explicit.

Always define:

ForeignKey

relationship()

back_populates

---

Never store secrets directly.

Use encryption

---

Create indexes for:

organization_id

created_at

status

foreign keys

frequently queried columns