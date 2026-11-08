import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ApiError } from "@/services/api";
import {
  COMPACT_COMMAND,
  COMPACT_THRESHOLD_FRACTION,
  compactBusyMessage,
  compactNoConversationMessage,
  compactSuccessMessage,
  compactThresholdMessage,
  describeCompactFailure,
  getSummaryTrigger,
  isCompactCommand,
  resolveFallbackWindow,
} from "../compact";

const chatDir = join(__dirname, "..");
const composerSrc = readFileSync(join(chatDir, "ChatComposer.tsx"), "utf8");
const workspaceSrc = readFileSync(join(__dirname, "..", "..", "ChatWorkspace.tsx"), "utf8");
const messageViewSrc = readFileSync(join(__dirname, "..", "..", "MessageView.tsx"), "utf8");
const panelSrc = readFileSync(join(__dirname, "..", "..", "ChatSettingsPanel.tsx"), "utf8");

describe("isCompactCommand exact matching", () => {
  it("matches the bare command", () => {
    expect(isCompactCommand("/compact")).toBe(true);
  });
  it("ignores leading/trailing whitespace", () => {
    expect(isCompactCommand("  /compact  ")).toBe(true);
    expect(isCompactCommand("\n\t/compact\n")).toBe(true);
  });
  it("rejects prefixed command text", () => {
    expect(isCompactCommand("/compactanything")).toBe(false);
    expect(isCompactCommand("/compact now")).toBe(false);
    expect(isCompactCommand("//compact")).toBe(false);
  });
  it("rejects ordinary text and empties", () => {
    expect(isCompactCommand("")).toBe(false);
    expect(isCompactCommand("   ")).toBe(false);
    expect(isCompactCommand("please /compact this")).toBe(false);
    expect(isCompactCommand("/Compact")).toBe(false);
  });
  it("exposes the threshold fraction", () => {
    expect(COMPACT_COMMAND).toBe("/compact");
    expect(COMPACT_THRESHOLD_FRACTION).toBe(0.2);
  });
});

describe("/compact never sends as chat", () => {
  it("routes the command before onSend in ChatComposer", () => {
    const cmdIdx = composerSrc.indexOf("isCompactCommand(draft)");
    const sendIdx = composerSrc.indexOf("onSend({");
    expect(cmdIdx).toBeGreaterThan(-1);
    expect(sendIdx).toBeGreaterThan(-1);
    expect(cmdIdx).toBeLessThan(sendIdx);
  });
  it("the command branch clears the draft and calls onCompact, not streamChat", () => {
    const branch = composerSrc.slice(
      composerSrc.indexOf("if (isCompactCommand(draft))"),
      composerSrc.indexOf("const text = draft.trim();"),
    );
    expect(branch).toContain("onCompact?.()");
    expect(branch).not.toContain("streamChat");
    expect(branch).not.toContain("onSend");
  });
  it("the workspace compact path creates no user node and calls no gateway", () => {
    const block = workspaceSrc.slice(
      workspaceSrc.indexOf("Manual compaction entry point"),
      workspaceSrc.indexOf("Global shortcut actions"),
    );
    expect(block).toContain("compactConversation(id)");
    expect(block).not.toContain("addOptimistic");
    expect(block).not.toContain("streamChat");
  });
  it("debounces repeated Enter with a single in-flight guard", () => {
    const block = workspaceSrc.slice(
      workspaceSrc.indexOf("Manual compaction entry point"),
      workspaceSrc.indexOf("Global shortcut actions"),
    );
    expect(block).toContain("if (compactingRef.current) return;");
    expect(block).toContain("compactingRef.current = true;");
  });
});

describe("compact notices", () => {
  it("names the no-conversation case", () => {
    expect(compactNoConversationMessage()).toMatch(/active conversation/i);
  });
  it("names the busy case", () => {
    expect(compactBusyMessage()).toMatch(/already running|wait/i);
  });
  it("threshold copy carries the exact sentence plus usage/window when available", () => {
    expect(compactThresholdMessage(null, null)).toBe(
      "Conversation compaction is available once the context usage exceeds 20%.",
    );
    const withNumbers = compactThresholdMessage(50000, 200000);
    expect(withNumbers).toContain("Conversation compaction is available once the context usage exceeds 20%.");
    expect(withNumbers).toContain("50,000");
    expect(withNumbers).toContain("200,000");
  });
  it("success copy names tokens before and after", () => {
    const msg = compactSuccessMessage({
      status: "compacted",
      summary_message_id: "s1",
      tokens_before: 10000,
      tokens_after: 2000,
      context_window: 200000,
      usage_before: 0.05,
      usage_after: 0.01,
      coverage_through_message_id: "m9",
      trigger: "manual",
    });
    expect(msg).toContain("10,000");
    expect(msg).toContain("2,000");
  });
});

describe("describeCompactFailure", () => {
  function apiError(status: number, body: unknown): ApiError {
    return new ApiError(status, "err", body, `POST -> ${status}`);
  }
  it("maps 422 to the threshold copy", () => {
    const f = describeCompactFailure(apiError(422, { error: { message: "" } }));
    expect(f.kind).toBe("threshold");
    expect(f.description).toContain("exceeds 20%");
  });
  it("prefers the backend detail message when it explains", () => {
    const f = describeCompactFailure(apiError(422, { error: { message: "usage 3% below 20%" } }));
    expect(f.description).toBe("usage 3% below 20%");
  });
  it("uses the live usage/window fallback when the backend is silent", () => {
    const f = describeCompactFailure(apiError(422, null), compactThresholdMessage(1000, 128000));
    expect(f.description).toContain("1,000");
  });
  it("titles config errors accurately, never as below-threshold", () => {
    for (const message of [
      "no active model selected for this conversation",
      "model openai/gpt-4o has no context-window metadata: set context_window on the model or sync the model repository",
    ]) {
      const f = describeCompactFailure(apiError(422, { error: { message } }));
      expect(f.kind).toBe("error");
      expect(f.title).toBe("Compaction unavailable");
      expect(f.description).toBe(message);
    }
  });
  it("keeps the threshold title for usage-ratio rejections", () => {
    const f = describeCompactFailure(
      apiError(422, { error: { message: "conversation uses 3% of the context window (minimum 20% to compact)" } }),
    );
    expect(f.kind).toBe("threshold");
    expect(f.title).toBe("Not enough context to compact");
  });
  it("maps 409 to busy, 404 to not-found, 500 to retryable error", () => {
    expect(describeCompactFailure(apiError(409, null)).kind).toBe("busy");
    expect(describeCompactFailure(apiError(404, null)).kind).toBe("not-found");
    const err = describeCompactFailure(apiError(500, null));
    expect(err.kind).toBe("error");
    expect(workspaceSrc).toContain("Re-enter /compact to retry.");
  });
});

describe("summary node presentation", () => {
  it("renders a distinct header with trigger badge and toggle", () => {
    for (const testid of ["summary-header-", "summary-trigger-", "summary-toggle-", "summary-body-"]) {
      expect(messageViewSrc).toContain(testid);
    }
    expect(messageViewSrc).toContain("Summary");
  });
  it("tolerates absent triggers", () => {
    expect(getSummaryTrigger(undefined)).toBeNull();
    expect(getSummaryTrigger({})).toBeNull();
    expect(getSummaryTrigger({ compaction_trigger: "auto" })).toBe("auto");
    expect(getSummaryTrigger({ compaction_trigger: "manual" })).toBe("manual");
    expect(getSummaryTrigger({ trigger: "auto" })).toBe("auto");
    expect(getSummaryTrigger({ compaction: { trigger: "auto" } })).toBe("auto");
    expect(getSummaryTrigger({ compaction: { trigger: "manual" } })).toBe("manual");
  });
  it("keeps version selectors outside the collapsed wrapper (pass-through)", () => {
    const bodyClose = messageViewSrc.indexOf("summary-body-${message.id}");
    const pager = messageViewSrc.indexOf("generation-nav-");
    expect(bodyClose).toBeGreaterThan(-1);
    expect(pager).toBeGreaterThan(bodyClose);
  });
  it("leaves failed/cancelled styling untouched", () => {
    expect(messageViewSrc).toContain("failed-");
    expect(messageViewSrc).toContain("stopped-");
  });
  it("keeps the summary role assistant-shaped for the Message primitive", () => {
    expect(messageViewSrc).toContain('from={isSummary ? "assistant" : role}');
  });
});

describe("refresh and usage paths", () => {
  it("compact success reloads history, tree, path, and usage", () => {
    const block = workspaceSrc.slice(
      workspaceSrc.indexOf("Manual compaction entry point"),
      workspaceSrc.indexOf("Global shortcut actions"),
    );
    expect(block).toContain("refreshAll(id)");
    for (const key of ["conversation-path", "conversation-tree", "usage"]) {
      expect(workspaceSrc).toContain(`"${key}"`);
    }
  });
  it("preparing hint shows until the first chunk, never as a modal", () => {
    expect(workspaceSrc).toContain('data-testid="compact-preparing"');
    expect(workspaceSrc).toContain("Preparing conversation context…");
    expect(workspaceSrc).not.toContain("compact-preparing-modal");
  });
  it("panel extends the existing usage bar with percent and threshold hint", () => {
    expect(panelSrc).toContain('data-testid="intelligence-context-pct"');
    expect(panelSrc).toContain('data-testid="intelligence-compact-hint"');
    expect(panelSrc).toContain("/compact");
  });
  it("composer shows compacting progress with reduced-motion honored", () => {
    expect(composerSrc).toContain('data-testid="compact-status"');
    expect(composerSrc).toContain("Compacting conversation history…");
    expect(composerSrc).toContain("motion-reduce:animate-none");
  });
});

describe("resolveFallbackWindow", () => {
  const models = [
    { id: "a", context_window: 128000 },
    { id: "b", context_window: 200000 },
  ];
  it("prefers the conversation model's own window", () => {
    expect(resolveFallbackWindow("a", "a", models)).toBe(128000);
  });
  it("falls back to the selection when the conversation names no model", () => {
    expect(resolveFallbackWindow(null, "b", models)).toBe(200000);
    expect(resolveFallbackWindow(undefined, "b", models)).toBe(200000);
  });
  it("omits the suffix (null) when the models differ", () => {
    expect(resolveFallbackWindow("a", "b", models)).toBeNull();
  });
  it("is null when the window is unknown", () => {
    expect(resolveFallbackWindow("a", "a", [])).toBeNull();
    expect(resolveFallbackWindow(null, null, models)).toBeNull();
  });
  it("the workspace pairs usage with the conversation model, never the bare selection", () => {
    expect(workspaceSrc).toContain("resolveFallbackWindow(compactModelId, modelId, scopedModels)");
    expect(workspaceSrc).not.toContain("scopedModels.find((m) => m.id === modelId)");
  });
});
