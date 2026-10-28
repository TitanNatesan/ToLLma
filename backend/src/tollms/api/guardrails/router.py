"""Guardrail endpoints only. No business logic."""

import uuid

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from tollms.api.guardrails import service
from tollms.api.guardrails.schemas import (
    CredentialsValidate,
    CredentialsValidateResult,
    EffectiveRead,
    EvaluatorCreate,
    EvaluatorPatch,
    EvaluatorRead,
    PolicyCreate,
    PolicyRead,
    PolicyUpdate,
    TemplateRead,
    TestRequest,
    TestResult,
    TriggerRead,
)
from tollms.core.deps import get_db
from tollms.core.security import require_active_user
from tollms.models.user import User

router = APIRouter(prefix="/api/v1/guardrails", tags=["guardrails"])


def _read_trigger(row) -> TriggerRead:
    return TriggerRead(
        id=row.id, policy_id=row.policy_id, policy_version=row.policy_version,
        workspace_type=row.workspace_type, endpoint=row.endpoint, source=row.source,
        stage=row.stage, category=row.category, severity=row.severity,
        confidence=row.confidence, enforcement=row.enforcement, action=row.action,
        reason=row.reason, input_excerpt=row.input_excerpt,
        output_excerpt=row.output_excerpt,
        latency_ms=row.latency_ms, notified=row.notified,
        failure_kind=row.failure_kind, created_at=row.created_at)


def _read_evaluator(config) -> EvaluatorRead:
    return EvaluatorRead(
        id=config.id, evaluator_type=config.evaluator_type,
        provider_id=config.provider_id, model_ref=config.model_ref,
        credentials_masked=service.masked_credentials(config),
        operation=config.operation, timeout_ms=config.timeout_ms,
        threshold=config.threshold)


@router.get("", response_model=list[PolicyRead])
def list_policies(org_id: uuid.UUID | None = None,
                  db: Session = Depends(get_db),
                  user: User = Depends(require_active_user)) -> list[PolicyRead]:
    return service.list_policies(db, user.id, org_id)


@router.post("", response_model=PolicyRead, status_code=201)
def create(data: PolicyCreate, db: Session = Depends(get_db),
           user: User = Depends(require_active_user)) -> PolicyRead:
    return service.read_policy(service.create_policy(db, user.id, data))


@router.get("/templates", response_model=list[TemplateRead])
def templates(db: Session = Depends(get_db),
              user: User = Depends(require_active_user)) -> list[TemplateRead]:
    del user
    return service.list_templates(db)


@router.post("/from-template/{key}", response_model=PolicyRead, status_code=201)
def from_template(key: str, org_id: uuid.UUID | None = None,
                  db: Session = Depends(get_db),
                  user: User = Depends(require_active_user)) -> PolicyRead:
    return service.read_policy(service.from_template(db, user.id, key, org_id))


@router.get("/health/laya")
def laya_health(org_id: uuid.UUID | None = None,
                db: Session = Depends(get_db),
                user: User = Depends(require_active_user)) -> dict:
    return service.laya_health(db, user.id, org_id)


@router.post("/credentials/validate", response_model=CredentialsValidateResult)
def credentials_validate(data: CredentialsValidate,
                         org_id: uuid.UUID | None = None,
                         db: Session = Depends(get_db),
                         user: User = Depends(require_active_user)) -> CredentialsValidateResult:
    result = service.validate_credentials(
        db, user.id, org_id, data.evaluator_type, data.credentials, data.base_url)
    return CredentialsValidateResult(**result)


@router.get("/effective", response_model=EffectiveRead)
def effective(org_id: uuid.UUID | None = None,
              provider_id: uuid.UUID | None = None,
              model_id: uuid.UUID | None = None,
              key_id: uuid.UUID | None = Query(default=None, alias="key_id"),
              source: str = "internal",
              db: Session = Depends(get_db),
              user: User = Depends(require_active_user)) -> EffectiveRead:
    policies, deciding = service.effective(
        db, user.id, org_id, provider_id, model_id, key_id, source)
    return EffectiveRead(policies=policies, deciding_policy_id=deciding)


@router.get("/triggers", response_model=list[TriggerRead])
def triggers(response: Response,
             org_id: uuid.UUID | None = None,
             workspace_type: str | None = None,
             policy_id: uuid.UUID | None = None,
             severity: str | None = None,
             action: str | None = None,
             source: str | None = None,
             provider_id: uuid.UUID | None = None,
             key_id: uuid.UUID | None = None,
             limit: int = 50,
             cursor: str | None = None,
             db: Session = Depends(get_db),
             user: User = Depends(require_active_user)) -> list[TriggerRead]:
    rows, next_cursor = service.list_triggers(
        db, user.id, org_id, workspace_type=workspace_type, policy_id=policy_id,
        severity=severity, action=action, source=source, provider_id=provider_id,
        key_id=key_id, limit=limit, cursor=cursor)
    if next_cursor is not None:
        response.headers["X-Next-Cursor"] = next_cursor
    return [_read_trigger(r) for r in rows]


@router.get("/triggers/{trigger_id}", response_model=TriggerRead)
def trigger(trigger_id: uuid.UUID, org_id: uuid.UUID | None = None,
            db: Session = Depends(get_db),
            user: User = Depends(require_active_user)) -> TriggerRead:
    return _read_trigger(service.get_trigger(db, user.id, trigger_id, org_id))


@router.get("/{policy_id}", response_model=PolicyRead)
def get(policy_id: uuid.UUID, org_id: uuid.UUID | None = None,
        db: Session = Depends(get_db),
        user: User = Depends(require_active_user)) -> PolicyRead:
    return service.read_policy(service.get_policy(db, user.id, policy_id, org_id))


@router.patch("/{policy_id}", response_model=PolicyRead)
def update(policy_id: uuid.UUID, data: PolicyUpdate,
           org_id: uuid.UUID | None = None,
           db: Session = Depends(get_db),
           user: User = Depends(require_active_user)) -> PolicyRead:
    return service.read_policy(service.update_policy(db, user.id, policy_id, org_id, data))


@router.delete("/{policy_id}", status_code=204)
def delete(policy_id: uuid.UUID, org_id: uuid.UUID | None = None,
           db: Session = Depends(get_db),
           user: User = Depends(require_active_user)) -> None:
    service.delete_policy(db, user.id, policy_id, org_id)


@router.post("/{policy_id}/clone", response_model=PolicyRead, status_code=201)
def clone(policy_id: uuid.UUID, org_id: uuid.UUID | None = None,
          db: Session = Depends(get_db),
          user: User = Depends(require_active_user)) -> PolicyRead:
    return service.read_policy(service.clone_policy(db, user.id, policy_id, org_id))


@router.post("/{policy_id}/enable", response_model=PolicyRead)
def enable(policy_id: uuid.UUID, org_id: uuid.UUID | None = None,
           db: Session = Depends(get_db),
           user: User = Depends(require_active_user)) -> PolicyRead:
    return service.read_policy(service.set_enabled(db, user.id, policy_id, org_id, True))


@router.post("/{policy_id}/disable", response_model=PolicyRead)
def disable(policy_id: uuid.UUID, org_id: uuid.UUID | None = None,
            db: Session = Depends(get_db),
            user: User = Depends(require_active_user)) -> PolicyRead:
    return service.read_policy(service.set_enabled(db, user.id, policy_id, org_id, False))


@router.post("/{policy_id}/test", response_model=TestResult)
def test(policy_id: uuid.UUID, data: TestRequest,
         org_id: uuid.UUID | None = None,
         db: Session = Depends(get_db),
         user: User = Depends(require_active_user)) -> TestResult:
    return TestResult(**service.test_policy(
        db, user.id, policy_id, org_id, data.content, data.stage,
        data.credentials, data.run_llm))


@router.get("/{policy_id}/evaluators", response_model=list[EvaluatorRead])
def list_evaluators(policy_id: uuid.UUID, org_id: uuid.UUID | None = None,
                    db: Session = Depends(get_db),
                    user: User = Depends(require_active_user)) -> list[EvaluatorRead]:
    policy = service.get_policy(db, user.id, policy_id, org_id)
    return [_read_evaluator(e) for e in (policy.evaluators or []) if not e.is_deleted]


@router.post("/{policy_id}/evaluators", response_model=EvaluatorRead, status_code=201)
def create_evaluator(policy_id: uuid.UUID, data: EvaluatorCreate,
                     org_id: uuid.UUID | None = None,
                     db: Session = Depends(get_db),
                     user: User = Depends(require_active_user)) -> EvaluatorRead:
    return _read_evaluator(service.create_evaluator(db, user.id, policy_id, org_id, data))


@router.patch("/evaluators/{evaluator_id}", response_model=EvaluatorRead)
def patch_evaluator(evaluator_id: uuid.UUID, data: EvaluatorPatch,
                    org_id: uuid.UUID | None = None,
                    db: Session = Depends(get_db),
                    user: User = Depends(require_active_user)) -> EvaluatorRead:
    return _read_evaluator(service.patch_evaluator(db, user.id, evaluator_id, org_id, data))


@router.post("/evaluators/{evaluator_id}/revalidate",
             response_model=CredentialsValidateResult)
def revalidate_evaluator(evaluator_id: uuid.UUID,
                         org_id: uuid.UUID | None = None,
                         db: Session = Depends(get_db),
                         user: User = Depends(require_active_user)) -> CredentialsValidateResult:
    return CredentialsValidateResult(
        **service.revalidate_evaluator(db, user.id, evaluator_id, org_id))


@router.delete("/evaluators/{evaluator_id}", status_code=204)
def delete_evaluator(evaluator_id: uuid.UUID, org_id: uuid.UUID | None = None,
                     db: Session = Depends(get_db),
                     user: User = Depends(require_active_user)) -> None:
    service.delete_evaluator(db, user.id, evaluator_id, org_id)
