"""Question builder: category coverage, aliasing, unknown handling."""

from questions import ACTION_QID, SEVERITY_QID, build_questions


def test_builds_noul_per_category_plus_action_and_severity():
    q, evaluated, unevaluated = build_questions(["prompt_injection", "pii"])
    assert set(evaluated) == {"prompt_injection", "pii"}
    assert unevaluated == []
    assert q["cat:prompt_injection"]["type"] == "noul"
    assert q[ACTION_QID]["type"] == "choice"
    assert set(q[ACTION_QID]["criteria"]) == {"allow", "review", "block"}
    assert q[SEVERITY_QID]["type"] == "score"
    assert len(q[SEVERITY_QID]["criteria"]) == 5


def test_aliases_resolve_to_canonical_ids():
    q, evaluated, unevaluated = build_questions(
        ["data_exfiltration", "tool_abuse", "policy_violation"])
    assert set(evaluated) == {"data_disclosure", "tool_action", "domain_violation"}
    assert unevaluated == []
    assert "cat:data_disclosure" in q


def test_unknown_and_non_model_categories_are_unevaluated():
    q, evaluated, unevaluated = build_questions(
        ["prompt_injection", "nope_not_a_cat", "invalid_structure"])
    assert evaluated == ["prompt_injection"]
    assert set(unevaluated) == {"nope_not_a_cat", "invalid_structure"}
    assert all("nope" not in k and "invalid" not in k for k in q)


def test_empty_and_duplicate_categories():
    q, evaluated, unevaluated = build_questions(["pii", " PII ", "", "pii"])
    assert evaluated == ["pii"]
    assert unevaluated == []
    assert len([k for k in q if k.startswith("cat:")]) == 1


def test_empty_list_still_asks_action_and_severity():
    q, evaluated, unevaluated = build_questions([])
    assert evaluated == [] and unevaluated == []
    assert ACTION_QID in q and SEVERITY_QID in q
