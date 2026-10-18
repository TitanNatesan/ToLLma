"""Catalog connection templates, create-from-slug, and related security fixes.

Covers: template mapping counts + 404 + credential_fields shapes,
personal/org creation from a catalog slug (stamp, prefill, caller-wins,
cross-org 404), other-owner-row invisibility, org perm gates on
validate/discover/credential-rotate, conversation ref validation, and
sync idempotency (incl. full models.dev raw payload survival).
"""

import json
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from tollms.api.catalog import service as catalog_service
from tollms.core.crypto import encrypt
from tollms.core.exceptions import ValidationError
from tollms.models.provider import Provider, ProviderType
from tollms.models.provider_catalog import ProviderCatalog
from tollms.services.model_repository import sync as sync_engine
from tollms.services.model_repository.sources import (
    ModelsDevSourceAdapter,
    normalize_modelsdev_providers,
)

ORG = "/api/v1/orgs"
TEMPLATE = "/api/v1/catalog/providers/{slug}/connection-template"

NPM_SAMPLE = {
    # OpenAI-compatible SDK -> CUSTOM gateway family.
    "acme": {
        "id": "acme", "name": "Acme", "api": "https://api.acme.dev/v1",
        "doc": "https://acme.dev/docs", "npm": "@ai-sdk/openai-compatible",
        "env": ["ACME_API_KEY"],
        "models": {"m1": {"name": "M1", "cost": {}, "limit": {}}},
    },
    # Anthropic SDK -> ANTHROPIC_MESSAGES gateway family.
    "mini-lab": {
        "id": "mini-lab", "name": "Mini Lab", "npm": "@ai-sdk/anthropic",
        "env": ["MINILAB_API_KEY"],
        "models": {"m1": {"name": "M1", "cost": {}, "limit": {}}},
    },
    # Native SDK (groq) -> catalog-only, never a gateway connection.
    "groq": {
        "id": "groq", "name": "Groq", "npm": "@ai-sdk/groq",
        "env": ["GROQ_API_KEY"],
        "models": {"m1": {"name": "M1", "cost": {}, "limit": {}}},
    },
    # No SDK metadata -> catalog-only.
    "mystery": {
        "id": "mystery", "name": "Mystery",
        "models": {"m1": {"name": "M1", "cost": {}, "limit": {}}},
    },
    # Explicit slug mapping wins over npm.
    "openai": {
        "id": "openai", "name": "OpenAI", "npm": "@ai-sdk/openai",
        "env": ["OPENAI_API_KEY"],
        "models": {"m1": {"name": "M1", "cost": {}, "limit": {}}},
    },
}


def _seed(db: Session) -> None:
    sync_engine.sync_provider_catalog(db, normalize_modelsdev_providers(NPM_SAMPLE), {})
    db.commit()


# --- gateway mapping -----------------------------------------------------------


def test_npm_gateway_mapping_counts(db: Session) -> None:
    _seed(db)
    rows = {r.slug: r for r in db.execute(select(ProviderCatalog)).scalars().all()}
    assert rows["acme"].gateway_family == "CUSTOM" and rows["acme"].gateway_supported is True
    assert rows["mini-lab"].gateway_family == "ANTHROPIC_MESSAGES"
    assert rows["mini-lab"].gateway_supported is True
    assert rows["groq"].gateway_family is None and rows["groq"].gateway_supported is False
    assert rows["mystery"].gateway_family is None and rows["mystery"].gateway_supported is False
    assert rows["openai"].gateway_family == "OPENAI"  # slug wins over npm
    supported = sum(1 for r in rows.values() if r.gateway_supported)
    assert supported == 3 and len(rows) - supported == 2


def test_modelsdev_raw_keeps_full_payload() -> None:
    info = {"name": "M1", "cost": {"input": 1}, "limit": {"context": 8},
            "knowledge": "2024", "open_weights": True, "tool_call": True}
    rec = ModelsDevSourceAdapter()._normalize_one("acme", "m1", info)
    assert rec is not None and rec.raw == info


# --- connection template --------------------------------------------------------


def test_template_openai_compatible(client: TestClient, db: Session, user_factory) -> None:
    user_factory()
    _seed(db)
    r = client.post(TEMPLATE.format(slug="acme"))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["slug"] == "acme" and body["name"] == "Acme"
    assert body["api_base_url"] == "https://api.acme.dev/v1"
    assert body["doc_url"] == "https://acme.dev/docs"
    assert body["npm_package"] == "@ai-sdk/openai-compatible"
    assert body["env_vars"] == ["ACME_API_KEY"]
    assert body["gateway_family"] == "CUSTOM" and body["gateway_supported"] is True
    assert body["suggested_provider_type"] == "CUSTOM"
    assert body["suggested_base_url"] == "https://api.acme.dev/v1"
    fields = {f["key"]: f for f in body["credential_fields"]}
    assert fields["ACME_API_KEY"] == {
        "key": "ACME_API_KEY", "label": "Acme Api Key", "required": True, "secret": True,
    }
    assert fields["base_url"] == {
        "key": "base_url", "label": "Base URL", "required": False, "secret": False,
    }


def test_template_anthropic_and_catalog_only(client: TestClient, db: Session, user_factory) -> None:
    user_factory()
    _seed(db)
    mini = client.post(TEMPLATE.format(slug="mini-lab")).json()
    assert mini["suggested_provider_type"] == "ANTHROPIC_MESSAGES"
    assert mini["suggested_base_url"] is None  # no api URL in the row
    assert [f["key"] for f in mini["credential_fields"]] == ["MINILAB_API_KEY"]
    groq = client.post(TEMPLATE.format(slug="groq")).json()
    assert groq["gateway_supported"] is False and groq["gateway_family"] is None
    assert groq["suggested_provider_type"] is None
    assert groq["credential_fields"][0]["secret"] is True


def test_template_unknown_slug_404_and_auth(client: TestClient, db: Session, user_factory) -> None:
    user_factory()
    _seed(db)
    assert client.post(TEMPLATE.format(slug="nope")).status_code == 404
    anon = TestClient(client.app)
    assert anon.post(TEMPLATE.format(slug="acme")).status_code in (401, 403)


# --- create from slug -------------------------------------------------------------


def test_create_personal_from_slug_prefills_and_stamps(
    client: TestClient, db: Session, user_factory
) -> None:
    user_factory()
    _seed(db)
    r = client.post("/api/v1/providers", json={
        "name": "AcmeConn", "provider_type": "CUSTOM",
        "credentials": {"api_key": "k"}, "catalog_slug": "acme",
    })
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["metadata"]["catalog"] == {"slug": "acme", "gateway_family": "CUSTOM"}
    assert body["credentials_masked"]["base_url"] == "https://api.acme.dev/v1"


def test_create_caller_credentials_win(client: TestClient, db: Session, user_factory) -> None:
    user_factory()
    _seed(db)
    r = client.post("/api/v1/providers", json={
        "name": "AcmeMine", "provider_type": "CUSTOM",
        "credentials": {"api_key": "k", "base_url": "https://mine.example/v1"},
        "catalog_slug": "acme",
    })
    assert r.status_code == 201, r.text
    assert r.json()["credentials_masked"]["base_url"] == "https://mine.example/v1"


def test_create_unknown_slug_404(client: TestClient, user_factory) -> None:
    user_factory()
    r = client.post("/api/v1/providers", json={
        "name": "Ghost", "provider_type": "CUSTOM",
        "credentials": {"base_url": "http://mock"}, "catalog_slug": "nope",
    })
    assert r.status_code == 404


def _mkuser(tag: str, app) -> TestClient:
    c = TestClient(app)
    email = f"tmpl-{tag}-{uuid.uuid4().hex[:8]}@tollma.ai"
    r = c.post("/auth/signup", json={"email": email, "password": "Password123"})
    assert r.status_code == 200, r.text
    token = r.json().get("debug_verification_token")
    if token:
        assert c.get("/auth/verify", params={"token": token}).status_code == 200
    return c


def test_create_org_from_slug_and_cross_org_404(
    client: TestClient, db: Session, user_factory
) -> None:
    from tollms.main import app

    user_factory()
    _seed(db)
    oid = client.post(ORG, json={"name": "Slug Org"}).json()["id"]
    r = client.post(f"{ORG}/{oid}/providers", json={
        "name": "AcmeOrg", "provider_type": "CUSTOM",
        "credentials": {"api_key": "k"}, "catalog_slug": "acme",
    })
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["metadata"]["catalog"] == {"slug": "acme", "gateway_family": "CUSTOM"}
    assert body["credentials_masked"]["base_url"] == "https://api.acme.dev/v1"
    # Stranger (no membership) creating with a slug in this org: 404 oracle.
    stranger = _mkuser("stranger", app)
    assert stranger.post(f"{ORG}/{oid}/providers", json={
        "name": "X", "provider_type": "CUSTOM",
        "credentials": {"base_url": "http://mock"}, "catalog_slug": "acme",
    }).status_code == 404
    # Updating through the wrong org: 404.
    oid2 = stranger.post(ORG, json={"name": "Other"}).json()["id"]
    assert stranger.patch(
        f"{ORG}/{oid2}/providers/{body['id']}", json={"name": "Hijack"}
    ).status_code == 404


# --- ownerless-row invisibility ------------------------------------------------------


def _other_owner_provider(db: Session, owner_id: uuid.UUID) -> uuid.UUID:
    """Provider owned by someone else: outside the caller's scope. (Both-null
    ownerless rows are impossible now — ck_providers_owner_scope rejects them
    at insert; see test_scope_isolation.)"""
    row = Provider(
        user_id=owner_id, org_id=None, name="Legacy",
        provider_type=ProviderType.CUSTOM,
        credentials_encrypted=encrypt(json.dumps({"base_url": "http://mock"})),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row.id


def test_other_owner_rows_invisible(client: TestClient, db: Session, user_factory) -> None:
    from tollms.api.keys.schemas import ApiKeyCreate, ModelPermissionIn
    from tollms.api.keys import service as keys_service
    from tollms.api.models.schemas import ModelCreate
    from tollms.api.models import service as models_service

    other = user_factory("legacy-other@tollma.ai")
    user = user_factory()
    uid = uuid.UUID(user["id"])
    legacy_id = _other_owner_provider(db, uuid.UUID(other["id"]))
    # Unscoped internals can still register the model; scoped reads cannot see it.
    model = models_service.create_model(
        db, ModelCreate(provider_id=legacy_id, model_id="legacy-m", name="Legacy M",
                        endpoint_type="chat_completions"),
        user_id=None,
    )
    assert models_service.list_models(db, user_id=uid) == []
    with pytest.raises(Exception):
        models_service.get_model(db, model.id, uid)
    assert client.get("/api/v1/models").json() == []
    assert client.get(f"/api/v1/models/{model.id}").status_code == 404
    with pytest.raises(ValidationError):
        keys_service.prepare_key_parts(
            db,
            ApiKeyCreate(name="k", model_permissions=[
                ModelPermissionIn(provider_id=legacy_id)]),
            uid,
        )


# --- org perm gates -----------------------------------------------------------------


def _org_with_member(client: TestClient, app, db):
    """Root org + one Member-set user; returns (oid, member_client)."""
    from tollms.models.organization import Invitation

    oid = client.post(ORG, json={"name": "Perm Org"}).json()["id"]
    sets = client.get(f"{ORG}/{oid}/sets").json()
    member_set = next(s["id"] for s in sets if s["name"] == "Member")
    member = _mkuser("member", app)
    member_email = member.get("/auth/me").json()["email"]
    inv = client.post(f"{ORG}/{oid}/invitations",
                      json={"email": member_email, "set_ids": [member_set]})
    assert inv.status_code == 201, inv.text
    inv_row = db.get(Invitation, uuid.UUID(inv.json()["id"]))
    db.refresh(inv_row)
    acc = member.post(f"{ORG}/invitations/by-token/{inv_row.token}/accept")
    assert acc.status_code == 200, acc.text
    return oid, member


def test_org_validate_and_discover_perm_gates(
    client: TestClient, db: Session, user_factory
) -> None:
    from tollms.main import app

    user_factory()
    oid, member = _org_with_member(client, app, db)
    prov = client.post(f"{ORG}/{oid}/providers", json={
        "name": "OrgVal", "provider_type": "OPENAI", "credentials": {"api_key": ""},
    })
    assert prov.status_code == 201, prov.text
    pid = prov.json()["id"]
    # Member without the perms: 404 oracle, no probe, on both endpoints.
    assert member.post(f"/api/v1/providers/{pid}/validate").status_code == 404
    assert member.post(f"/api/v1/providers/{pid}/discover").status_code == 404
    # Root (all perms): validate fails fast offline on the empty key, no 404.
    ok = client.post(f"/api/v1/providers/{pid}/validate").json()
    assert ok["valid"] is False


def test_org_credential_update_requires_rotate(
    client: TestClient, db: Session, user_factory
) -> None:
    from tollms.main import app

    user_factory()
    oid, member = _org_with_member(client, app, db)
    prov = client.post(f"{ORG}/{oid}/providers", json={
        "name": "OrgRot", "provider_type": "CUSTOM",
        "credentials": {"base_url": "http://mock"},
    }).json()
    pid = prov["id"]
    # Member with the bare system Member set: not even plain updates.
    assert member.patch(f"{ORG}/{oid}/providers/{pid}", json={"name": "N"}).status_code == 404
    # Grant Update without RotateCredentials: renames pass, credential writes 404.
    set_id = client.post(f"{ORG}/{oid}/sets", json={
        "name": "Updater", "permissions": ["Providers.Read", "Providers.Update"],
    }).json()["id"]
    member_id = member.get("/auth/me").json()["id"]
    assign = client.post(f"{ORG}/{oid}/members/{member_id}/sets",
                         json={"set_ids": [set_id]})
    assert assign.status_code == 200, assign.text
    assert member.patch(f"{ORG}/{oid}/providers/{pid}", json={"name": "Renamed"}).status_code == 200
    assert member.patch(f"{ORG}/{oid}/providers/{pid}",
                        json={"credentials": {"base_url": "http://evil"}}).status_code == 404
    # Org audit recorded the rename.
    actions = [a["action"] for a in client.get(f"{ORG}/{oid}/audit").json()]
    assert "provider.updated" in actions


# --- conversation refs -----------------------------------------------------------------


def test_conversation_invalid_refs_404(
    client: TestClient, user_factory, provider_factory, model_factory
) -> None:
    from tollms.main import app

    user_factory()
    p = provider_factory("CP")
    m = model_factory(p["id"])
    ghost = str(uuid.uuid4())
    assert client.post("/api/v1/conversations",
                       json={"title": "G", "provider_id": ghost}).status_code == 404
    assert client.post("/api/v1/conversations",
                       json={"title": "G", "model_id": ghost}).status_code == 404
    other = _mkuser("other", app)
    assert other.post("/api/v1/conversations",
                      json={"title": "X", "provider_id": p["id"],
                            "model_id": m["id"]}).status_code == 404
    ok = client.post("/api/v1/conversations",
                     json={"title": "V", "provider_id": p["id"], "model_id": m["id"]})
    assert ok.status_code == 201, ok.text


# --- sync idempotency -------------------------------------------------------------------


def test_sync_idempotent_no_dupes(db: Session) -> None:
    from tollms.models.model_repository import RepositoryModel

    modelsdev = {"acme": dict(NPM_SAMPLE["acme"])}
    modelsdev["acme"]["models"] = {
        "gpt-5": {
            "id": "gpt-5", "name": "GPT-5",
            "modalities": {"input": ["text"], "output": ["text"]},
            "limit": {"context": 1000, "output": 100},
            "cost": {"input": 1000.0, "output": 2000.0},
        },
        "m1": {"name": "M1", "cost": {}, "limit": {}},
    }
    kw = {"modelsdev_data": modelsdev}
    first = sync_engine.run_sync(db, **kw)
    assert first.status == "done", first.error_details
    n_models = db.scalar(select(func.count()).select_from(RepositoryModel)) or 0
    n_catalog = db.scalar(select(func.count()).select_from(ProviderCatalog)) or 0
    assert n_models > 0 and n_catalog == 1
    row = db.execute(select(ProviderCatalog).where(ProviderCatalog.slug == "acme")).scalars().one()
    assert row.gateway_family == "CUSTOM" and row.gateway_supported is True
    second = sync_engine.run_sync(db, **kw)
    assert second.status == "done", second.error_details
    assert second.models_created == 0
    assert db.scalar(select(func.count()).select_from(RepositoryModel)) == n_models
    assert db.scalar(select(func.count()).select_from(ProviderCatalog)) == n_catalog
    # Full upstream model payload survives in JSONB (not a truncated subset).
    stored = db.execute(
        select(RepositoryModel).where(RepositoryModel.model_key == "acme/m1")
    ).scalars().first()
    assert stored is not None
    assert stored.raw_source_payload["modelsdev"] == {"name": "M1", "cost": {}, "limit": {}}
    assert stored.sources == ["modelsdev"]
