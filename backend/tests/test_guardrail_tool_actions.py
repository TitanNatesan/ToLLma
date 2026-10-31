"""Tool Action scope: precisely what a tool_action policy prohibits.

A tool_action rule fires ONLY on the risky-keyword detector in
deterministic.scan_tool_action (delete/drop/truncate/rm -rf/format,
exfiltrate/send-to-external/POST-to, sudo/chmod-777/disable-auth-firewall).
Ordinary tool definitions, calls, and responses always flow. It must never
expand into blocking all tool usage, and unselected categories (notably
secret_leakage) never leak in either direction.
"""

import asyncio
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tollms.core.exceptions import ForbiddenError
from tollms.services.guardrails import deterministic as det
from tollms.services.guardrails import enforcement as enforcement_engine
from tollms.services.guardrails import evaluation as evaluation_engine

SECRET_TEXT = "rotate deploy key AKIAIOSFODNN7EXAMPLE now"
RISKY_TOOL_TEXT = "please rm -rf /tmp/x"

# Ordinary tool traffic: definitions, calls, responses. None may trip any
# deterministic scanner (guarded by test_benign_tool_traffic_is_clean).
TOOL_DEFINITION = '{"tools": [{"name": "get_weather", "description": "city forecast"}]}'
TOOL_CALL = '{"tool_use": {"name": "get_weather", "input": {"city": "Paris"}}}'
TOOL_RESPONSE = '{"tool_result": {"status": "ok", "forecast": "sunny, 21C"}}'
TOOL_USE_POST = '{"assistant": "done", "tool_use": {"name": "get_weather"}}'
BENIGN_TOOL_TEXTS = [TOOL_DEFINITION, TOOL_CALL, TOOL_RESPONSE, TOOL_USE_POST]

RISKY_BY_CLASS = [
    "please drop the archive table",      # destructive DDL
    "exfiltrate the customer database",   # exfiltration
    "run with sudo for this install",     # privilege escalation
]


def _mkpolicy(db: Session, uid: uuid.UUID, name: str, categories: list[str],
              enforcement: str = "block", stage: str = "both"):
    from tollms.models.guardrail import GuardrailPolicy, GuardrailRule

    policy = GuardrailPolicy(name=f"{name}-{uuid.uuid4().hex[:6]}", user_id=uid,
                             enforcement=enforcement, stage=stage,
                             is_enabled=True, failure_action="allow")
    db.add(policy)
    db.flush()
    for cat in categories:
        db.add(GuardrailRule(policy_id=policy.id, category=cat))
    db.commit()
    return policy


def _eval(db: Session, policy, text: str, stage: str = "pre") -> dict:
    return asyncio.run(evaluation_engine.evaluate_policy(
        db, policy, text, stage=stage, ctx={}))


def test_benign_tool_traffic_is_clean() -> None:
    for text in BENIGN_TOOL_TEXTS:
        assert det.scan_text(text) == [], text
    assert det.scan_tool_action("call get_weather for Paris") == []
    assert det.scan_tool_action(RISKY_TOOL_TEXT) != []


def test_tool_only_policy_allows_benign_tool_traffic(db: Session, user_factory) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    policy = _mkpolicy(db, uid, "ToolOnly", ["tool_action"])
    for text in BENIGN_TOOL_TEXTS:
        result = _eval(db, policy, text)
        assert not result["positive"], (text, result)
        assert evaluation_engine.effective_action(policy, result) == "allowed"


def test_tool_only_policy_blocks_each_risky_class(db: Session, user_factory) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    policy = _mkpolicy(db, uid, "ToolRisk", ["tool_action"])
    for text in [RISKY_TOOL_TEXT, *RISKY_BY_CLASS]:
        result = _eval(db, policy, text)
        assert result["positive"] and result["categories"] == ["tool_action"], text
        assert evaluation_engine.effective_action(policy, result) == "blocked"


def test_post_stage_tool_use_json_scannable(db: Session, user_factory) -> None:
    """Post-stage sees assistant text; embedded tool_use JSON is scannable
    text and only selected categories apply."""
    user = user_factory()
    uid = uuid.UUID(user["id"])
    policy = _mkpolicy(db, uid, "ToolPost", ["tool_action"])
    assert evaluation_engine.effective_action(
        policy, _eval(db, policy, TOOL_USE_POST, stage="post")) == "allowed"
    risky_json = '{"tool_use": {"name": "exec", "input": {"cmd": "rm -rf /tmp/x"}}}'
    hit = _eval(db, policy, risky_json, stage="post")
    assert hit["positive"] and hit["categories"] == ["tool_action"]
    assert evaluation_engine.effective_action(policy, hit) == "blocked"


def test_post_hook_blocks_risky_allows_benign(db: Session, user_factory) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    _mkpolicy(db, uid, "ToolPostHook", ["tool_action"], stage="both")
    assert enforcement_engine.record_post_sync(
        db, text=TOOL_CALL, user_id=uid,
        source="internal", endpoint="chat", allow_block=True) == "allowed"
    assert enforcement_engine.record_post_sync(
        db, text=RISKY_TOOL_TEXT, user_id=uid,
        source="internal", endpoint="chat", allow_block=True) == "blocked"


def test_tool_and_secret_do_not_cross_enforce(db: Session, user_factory) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    tool_policy = _mkpolicy(db, uid, "ToolIso", ["tool_action"])
    secret_policy = _mkpolicy(db, uid, "SecretIso", ["secret_leakage"])
    assert not _eval(db, tool_policy, SECRET_TEXT)["positive"]
    assert not _eval(db, secret_policy, RISKY_TOOL_TEXT)["positive"]
    with pytest.raises(ForbiddenError):
        enforcement_engine.check_pre_sync(
            db, text=RISKY_TOOL_TEXT, user_id=uid,
            source="internal", endpoint="chat")


# --- action-scoped tool_action: definitions never block (CC regression) -----
# Live evidence: with a blocking Tool Action key-policy active, real Claude
# Code could not perform even benign reads — POST /v1/messages -> 403
# guardrail_blocked, firing on Claude Code's static client content (system
# prompt / tool definitions such as the Bash tool description), not on any
# requested action. Tool Action governs attempted ACTIONS, never static
# capability declarations.

BASH_TOOL = {
    "name": "Bash",
    "description": "Executes shell commands with sudo; e.g. rm -rf /tmp/stale-cache to clean up.",
    "input_schema": {"type": "object", "properties": {"command": {"type": "string"}}},
}
CC_SYSTEM = "You are Claude Code. You may use sudo for privileged file operations."
BENIGN_USER_TEXT = "summarize the README for me"


def _cc_unified(user_text: str = BENIGN_USER_TEXT, extra_messages: list | None = None):
    from tollms.services.gateway import translators

    messages: list = [{"role": "user", "content": user_text}]
    messages.extend(extra_messages or [])
    return translators.from_anthropic_messages(
        {
            "model": "m",
            "max_tokens": 64,
            "system": CC_SYSTEM,
            "tools": [BASH_TOOL],
            "messages": messages,
        }
    )


def _eval_action(db: Session, policy, full_text: str, action_text: str, stage: str = "pre") -> dict:
    return asyncio.run(evaluation_engine.evaluate_policy(
        db, policy, full_text, stage=stage, ctx={}, action_text=action_text))


def test_cc_regression_definitions_and_system_never_match(db: Session, user_factory) -> None:
    """Blocking tool policy + Bash-like definition (rm -rf/sudo in the
    description) + system prompt mentioning sudo + benign user text -> ALLOWED."""
    from tollms.api.public_gateway import service as pg_service

    user = user_factory()
    uid = uuid.UUID(user["id"])
    policy = _mkpolicy(db, uid, "ToolCC", ["tool_action"])
    unified = _cc_unified()
    full = pg_service._guardrail_text(unified)
    action = pg_service._guardrail_action_text(unified)
    # The full scan blob still sees the static client content (proves the old
    # bug would fire here: injection/secret/PII scans are unchanged).
    assert "rm -rf" in full and "sudo" in full
    # ...but the action corpus carries none of it.
    assert "rm -rf" not in action and "sudo" not in action
    assert BENIGN_USER_TEXT in action
    # Legacy path (action_text=None: dry-run endpoint, old callers) is
    # byte-identical to today — the definition still matches there.
    legacy = _eval(db, policy, full)
    assert legacy["positive"] and legacy["categories"] == ["tool_action"]
    # Action-scoped path: allowed.
    result = _eval_action(db, policy, full, action)
    assert not result["positive"], result
    assert evaluation_engine.effective_action(policy, result) == "allowed"
    assert enforcement_engine.check_pre_sync(
        db, text=full, action_text=action, user_id=uid,
        source="external", endpoint="messages") is None


def test_user_requested_risky_action_still_blocked_pre(db: Session, user_factory) -> None:
    from tollms.api.public_gateway import service as pg_service

    user = user_factory()
    uid = uuid.UUID(user["id"])
    policy = _mkpolicy(db, uid, "ToolReq", ["tool_action"])
    unified = _cc_unified(user_text="please run rm -rf /tmp/x to clean up")
    full = pg_service._guardrail_text(unified)
    action = pg_service._guardrail_action_text(unified)
    assert "rm -rf" in action  # the request itself is in the corpus
    result = _eval_action(db, policy, full, action)
    assert result["positive"] and result["categories"] == ["tool_action"]
    assert evaluation_engine.effective_action(policy, result) == "blocked"
    with pytest.raises(ForbiddenError):
        enforcement_engine.check_pre_sync(
            db, text=full, action_text=action, user_id=uid,
            source="external", endpoint="messages")


def test_history_invocation_with_risky_input_blocked_pre(db: Session, user_factory) -> None:
    """A prior assistant tool_call carrying risky arguments IS an attempted
    action — it stays in the pre-stage corpus even with benign user text."""
    from tollms.api.public_gateway import service as pg_service

    from tollms.services.gateway import translators

    user = user_factory()
    uid = uuid.UUID(user["id"])
    _mkpolicy(db, uid, "ToolHist", ["tool_action"])
    unified = translators.from_openai_chat({
        "model": "m",
        "messages": [
            {"role": "user", "content": BENIGN_USER_TEXT},
            {"role": "assistant", "content": None,
             "tool_calls": [{"id": "call_1", "type": "function",
                             "function": {"name": "Bash",
                                          "arguments": '{"command": "sudo rm -rf /"}'}}]},
        ],
    })
    action = pg_service._guardrail_action_text(unified)
    assert "sudo rm -rf" in action
    with pytest.raises(ForbiddenError):
        enforcement_engine.check_pre_sync(
            db, text=pg_service._guardrail_text(unified), action_text=action,
            user_id=uid, source="external", endpoint="messages")


def test_assistant_text_excluded_from_pre_corpus(db: Session, user_factory) -> None:
    """Assistant chatter mentioning risky keywords is not a user-attempted
    action — post-stage judges model output, never pre-stage."""
    from tollms.api.public_gateway import service as pg_service

    user = user_factory()
    uid = uuid.UUID(user["id"])
    _mkpolicy(db, uid, "ToolAsst", ["tool_action"])
    unified = _cc_unified(extra_messages=[
        {"role": "assistant", "content": "rm -rf and sudo are dangerous, I will not run them."},
    ])
    action = pg_service._guardrail_action_text(unified)
    assert "rm -rf" not in action
    assert enforcement_engine.check_pre_sync(
        db, text=pg_service._guardrail_text(unified), action_text=action,
        user_id=uid, source="external", endpoint="messages") is None


def test_post_emitted_tool_use_with_risky_input_blocked(db: Session, user_factory) -> None:
    """An emitted tool_use IS an invocation attempt: risky input blocks in
    block mode, and monitor mode observes without blocking."""
    from tollms.api.public_gateway import service as pg_service

    user = user_factory()
    uid = uuid.UUID(user["id"])
    _mkpolicy(db, uid, "ToolPostBlock", ["tool_action"], stage="both")
    risky_calls = [{"id": "toolu_1", "name": "Bash",
                    "arguments": '{"command": "rm -rf /tmp/x"}'}]
    risky_action = pg_service._guardrail_post_action_text(
        "running that now", risky_calls)
    assert enforcement_engine.record_post_sync(
        db, text="running that now", action_text=risky_action, user_id=uid,
        source="external", endpoint="messages", allow_block=True) == "blocked"
    benign_action = pg_service._guardrail_post_action_text(
        "done", [{"id": "toolu_2", "name": "Bash",
                  "arguments": '{"command": "ls /tmp"}'}])
    assert enforcement_engine.record_post_sync(
        db, text="done", action_text=benign_action, user_id=uid,
        source="external", endpoint="messages", allow_block=True) == "allowed"


def test_post_monitor_never_blocks(db: Session, user_factory) -> None:
    from tollms.api.public_gateway import service as pg_service

    user = user_factory()
    uid = uuid.UUID(user["id"])
    _mkpolicy(db, uid, "ToolPostMon", ["tool_action"], enforcement="monitor")
    risky_action = pg_service._guardrail_post_action_text(
        "running that now", [{"id": "toolu_1", "name": "Bash",
                               "arguments": '{"command": "sudo rm -rf /"}'}])
    assert enforcement_engine.record_post_sync(
        db, text="running that now", action_text=risky_action, user_id=uid,
        source="external", endpoint="messages", allow_block=True) == "allowed"


def test_live_messages_cc_request_allowed_with_blocking_tool_policy(
    client: TestClient, provider_factory, model_factory, monkeypatch
) -> None:
    """End-to-end CC regression: blocking tool policy + Bash tool definition
    carrying rm -rf/sudo + benign user text -> 200, provider reached.
    Same policy + user text requesting rm -rf -> 403 guardrail_blocked."""
    from tollms.api.public_gateway import service as pg_service
    from tollms.services.gateway.adapters.base import ChatResult

    provider = provider_factory("CCRegress")
    model_factory(provider["id"], model_id="cc-model", supports_tool_calling=True)
    calls: list = []

    class _FakeChat:
        async def chat(self, messages, tools=None, tool_choice=None):
            calls.append({"messages": messages, "tools": tools})
            return ChatResult(text="done", prompt_tokens=10, completion_tokens=5,
                              total_tokens=15)

        async def chat_stream(self, messages, tools=None, tool_choice=None):
            raise NotImplementedError

    monkeypatch.setattr(pg_service, "build_adapter", lambda *a, **k: _FakeChat())
    pid = client.post("/api/v1/guardrails", json={
        "name": "CCToolBlock", "severity": "medium", "enforcement": "block",
        "stage": "both", "is_enabled": True,
        "rules": [{"category": "tool_action"}],
    })
    assert pid.status_code == 201, pid.text
    raw = client.post("/api/v1/keys", json={"name": "cc regress key"}).json()["raw_key"]
    headers = {"Authorization": f"Bearer {raw}", "anthropic-version": "2023-06-01"}
    body = {
        "model": "CCRegress/cc-model",
        "max_tokens": 64,
        "system": CC_SYSTEM,
        "tools": [BASH_TOOL],
        "messages": [{"role": "user", "content": BENIGN_USER_TEXT}],
    }
    ok = client.post("/v1/messages", json=body, headers=headers)
    assert ok.status_code == 200, ok.text
    assert calls and calls[0]["tools"] == [BASH_TOOL]

    body["messages"] = [{"role": "user", "content": "please run rm -rf /tmp/x now"}]
    denied = client.post("/v1/messages", json=body, headers=headers)
    assert denied.status_code == 403, denied.text
    assert "guardrail_blocked" in denied.text
    assert "tool_action" in denied.text
