"""Provider lifecycle for operational model selection.

Domain rule under test: the global repository catalog intentionally retains
metadata, but `list_models`/`get_model` serve only models whose provider
connection is live (not deleted, active) and owned by the caller. Key
assignment validation already enforces the same rule; these tests pin the
listing side so deleted providers can never resurface as selectable.
"""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tollms.api.models.service import get_model, list_models
from tollms.core.exceptions import NotFoundError


def test_deleted_provider_models_excluded_from_listing(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory
) -> None:
    user_factory()
    provider = provider_factory(name="Doomed")
    live = provider_factory(name="Live")
    doomed_model = model_factory(provider["id"], model_id="doomed-model", name="Doomed Model")
    live_model = model_factory(live["id"], model_id="live-model", name="Live Model")

    before = {m.id for m in list_models(db, user_id=None)}
    assert uuid.UUID(doomed_model["id"]) in before
    assert uuid.UUID(live_model["id"]) in before

    delete = client.delete(f"/api/v1/providers/{provider['id']}")
    assert delete.status_code in (200, 204), delete.text

    after = {m.id for m in list_models(db, user_id=None)}
    assert uuid.UUID(doomed_model["id"]) not in after
    assert uuid.UUID(live_model["id"]) in after


def test_inactive_provider_models_excluded(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory
) -> None:
    user_factory()
    provider = provider_factory(name="Paused")
    model = model_factory(provider["id"], model_id="paused-model")
    assert uuid.UUID(model["id"]) in {m.id for m in list_models(db, user_id=None)}

    from tollms.models.provider import Provider

    row = db.get(Provider, uuid.UUID(provider["id"]))
    assert row is not None
    row.is_active = False
    db.commit()

    assert uuid.UUID(model["id"]) not in {m.id for m in list_models(db, user_id=None)}


def test_multi_provider_isolation_on_delete(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory
) -> None:
    """Provider A -> Model A, Provider B -> Model B; delete A => only B remains."""
    user_factory()
    provider_a = provider_factory(name="Provider A")
    provider_b = provider_factory(name="Provider B")
    model_a = model_factory(provider_a["id"], model_id="model-a")
    model_b = model_factory(provider_b["id"], model_id="model-b")

    assert client.delete(f"/api/v1/providers/{provider_a['id']}").status_code in (200, 204)
    remaining = {m.id for m in list_models(db, user_id=None)}
    assert uuid.UUID(model_a["id"]) not in remaining
    assert uuid.UUID(model_b["id"]) in remaining


def test_get_model_rejects_deleted_provider_models(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory
) -> None:
    user_factory()
    provider = provider_factory(name="Gone")
    model = model_factory(provider["id"], model_id="gone-model")
    assert get_model(db, uuid.UUID(model["id"])).id == uuid.UUID(model["id"])

    assert client.delete(f"/api/v1/providers/{provider['id']}").status_code in (200, 204)
    with pytest.raises(NotFoundError):
        get_model(db, uuid.UUID(model["id"]))


def test_global_catalog_survives_provider_deletion(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory
) -> None:
    """Deleting a connection must not destroy repository catalog metadata."""
    from sqlalchemy import func, select

    from tollms.models.model_repository import RepositoryModel

    user_factory()
    provider = provider_factory(name="Catalog Victim")
    model_factory(provider["id"], model_id="catalog-model")
    before = db.execute(
        select(func.count()).select_from(RepositoryModel).where(RepositoryModel.is_deleted.is_(False))
    ).scalar_one()

    assert client.delete(f"/api/v1/providers/{provider['id']}").status_code in (200, 204)

    after = db.execute(
        select(func.count()).select_from(RepositoryModel).where(RepositoryModel.is_deleted.is_(False))
    ).scalar_one()
    assert after == before


def test_model_listing_isolation_across_users(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory
) -> None:
    """User-scoped listing never surfaces another user's provider models."""
    me = user_factory("mine@tollma.ai")
    mine_provider = provider_factory(name="Mine")
    mine_model = model_factory(mine_provider["id"], model_id="mine-model")
    mine_id = uuid.UUID(me["id"])

    other = user_factory("theirs@tollma.ai")
    other_id = uuid.UUID(other["id"])
    visible = list_models(db, user_id=other_id)
    assert uuid.UUID(mine_model["id"]) not in {m.id for m in visible}
    with pytest.raises(NotFoundError):
        get_model(db, uuid.UUID(mine_model["id"]), other_id)

    assert get_model(db, uuid.UUID(mine_model["id"]), mine_id).id == uuid.UUID(mine_model["id"])


def test_duplicate_model_ids_across_connections_keep_stable_identity(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory
) -> None:
    """Same model_id on two live connections => two rows keyed by
    (provider_id, id); deleting one connection removes exactly its row."""
    user_factory()
    first = provider_factory(name="First")
    second = provider_factory(name="Second")
    row_a = model_factory(first["id"], model_id="shared-model")
    row_b = model_factory(second["id"], model_id="shared-model")
    assert row_a["id"] != row_b["id"]

    listed = [m for m in list_models(db, user_id=None) if m.model_id == "shared-model"]
    assert {str(m.provider_id) for m in listed} == {first["id"], second["id"]}

    assert client.delete(f"/api/v1/providers/{first['id']}").status_code in (200, 204)
    remaining = [m for m in list_models(db, user_id=None) if m.model_id == "shared-model"]
    assert [str(m.provider_id) for m in remaining] == [second["id"]]
