"""Tests for Bedrock adapter model resolution and profile routing."""

from tollms.modules.gateway.adapters.bedrock import resolve_bedrock_model_id


def test_resolve_bedrock_model_id():
    # 1. Strips bedrock/ prefix
    assert resolve_bedrock_model_id("bedrock/minimax.minimax-m2.5", "us-east-1") == "minimax.minimax-m2.5"

    # 2. Existing cross-region profile prefixes are preserved
    assert resolve_bedrock_model_id("us.anthropic.claude-haiku-4-5-20251001-v1:0", "us-east-1") == "us.anthropic.claude-haiku-4-5-20251001-v1:0"
    assert resolve_bedrock_model_id("global.anthropic.claude-haiku-4-5-20251001-v1:0", "us-east-1") == "global.anthropic.claude-haiku-4-5-20251001-v1:0"

    # 3. Foundation model IDs requiring inference profile are resolved with regional prefix
    assert resolve_bedrock_model_id("anthropic.claude-haiku-4-5-20251001-v1:0", "us-east-1") == "us.anthropic.claude-haiku-4-5-20251001-v1:0"
    assert resolve_bedrock_model_id("anthropic.claude-sonnet-4-6", "us-east-1") == "us.anthropic.claude-sonnet-4-6"
    assert resolve_bedrock_model_id("deepseek.r1-v1:0", "us-east-1") == "us.deepseek.r1-v1:0"

    # 4. EU regions get eu. prefix
    assert resolve_bedrock_model_id("anthropic.claude-haiku-4-5-20251001-v1:0", "eu-west-1") == "eu.anthropic.claude-haiku-4-5-20251001-v1:0"

    # 5. Non-profile models remain unchanged
    assert resolve_bedrock_model_id("amazon.titan-embed-text-v1", "us-east-1") == "amazon.titan-embed-text-v1"
