import { describe, expect, it } from "vitest";
import type { AIModel, ReasoningOption } from "@/types";
import {
  defaultReasoningLevel,
  getModelCapabilities,
  getReasoningControl,
  isReasoningValueValid,
  resolveReasoningValue,
} from "../capabilities";

function model(overrides: Partial<AIModel> = {}): AIModel {
  return {
    id: "m1",
    provider_id: "p1",
    model_id: "test-model",
    name: "Test Model",
    description: null,
    endpoint_type: "chat_completions",
    primary_endpoint: "chat_completions",
    supported_endpoints: ["chat_completions"],
    input_price: "0.000000",
    output_price: "0.000000",
    cache_read_price: "0.000000",
    cache_write_price: "0.000000",
    supports_text: true,
    supports_vision: false,
    supports_audio_input: false,
    supports_audio_output: false,
    supports_image_generation: false,
    supports_tool_calling: false,
    supports_reasoning: true,
    supports_embeddings: false,
    supports_streaming: true,
    context_window: null,
    max_output_tokens: null,
    release_date: null,
    repository_model_key: null,
    metadata: {},
    is_active: true,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function withOptions(options: ReasoningOption[] | null | undefined): AIModel {
  const base = model();
  if (options === undefined) {
    // Leave the key absent: pre-contract response (legacy metadata path).
    const { reasoning_options: _drop, ...rest } = base as unknown as Record<string, unknown>;
    void _drop;
    return rest as unknown as AIModel;
  }
  return { ...base, reasoning_options: options };
}

describe("getReasoningControl effort", () => {
  it("uses provided values verbatim and gates default on membership", () => {
    const control = getReasoningControl(
      withOptions([{ type: "effort", values: ["low", "high", "ultra"], default: "high" }]),
    );
    expect(control).toEqual({ kind: "effort", levels: ["none", "low", "high", "ultra"], defaultLevel: "high" });
  });

  it("nulls the default when it is not one of the values", () => {
    expect(
      getReasoningControl(withOptions([{ type: "effort", values: ["low", "high"], default: "ultra" }])),
    ).toEqual({ kind: "effort", levels: ["none", "low", "high"], defaultLevel: null });
    expect(
      getReasoningControl(withOptions([{ type: "effort", values: ["low", "high"] }])),
    ).toEqual({ kind: "effort", levels: ["none", "low", "high"], defaultLevel: null });
  });

  it("skips effort entries with empty values and falls through", () => {
    const control = getReasoningControl(
      withOptions([
        { type: "effort", values: [] },
        { type: "effort", values: ["a"], default: "a" },
      ]),
    );
    expect(control).toEqual({ kind: "effort", levels: ["none", "a"], defaultLevel: "a" });
  });

  it("always offers none first, keeping catalog order and deduping", () => {
    const control = getReasoningControl(withOptions([{ type: "effort", values: ["x"] }]));
    expect(control).toEqual({ kind: "effort", levels: ["none", "x"], defaultLevel: null });
    const duped = getReasoningControl(
      withOptions([{ type: "effort", values: ["low", "none", "high", "low"], default: "high" }]),
    );
    expect(duped).toEqual({ kind: "effort", levels: ["none", "low", "high"], defaultLevel: "high" });
  });
});

describe("getReasoningControl budget", () => {
  it("keeps min/max and a valid default", () => {
    expect(
      getReasoningControl(
        withOptions([{ type: "budget_tokens", min: 1024, max: 8192, default: "2048" }]),
      ),
    ).toEqual({ kind: "budget", min: 1024, max: 8192, defaultValue: "2048" });
  });

  it("floors min at zero and nulls an out-of-range default", () => {
    expect(
      getReasoningControl(
        withOptions([{ type: "budget_tokens", min: -5, max: 100, default: "999" }]),
      ),
    ).toEqual({ kind: "budget", min: 0, max: 100, defaultValue: null });
  });

  it("nulls max when it is below min and validates open-ended", () => {
    const control = getReasoningControl(withOptions([{ type: "budget_tokens", min: 10, max: 5 }]));
    expect(control).toEqual({ kind: "budget", min: 10, max: null, defaultValue: null });
    if (control?.kind === "budget") {
      expect(isReasoningValueValid(control, "100000")).toBe(true);
      expect(isReasoningValueValid(control, "9")).toBe(false);
    }
  });

  it("rejects non-numeric and out-of-range budget strings", () => {
    const control = getReasoningControl(
      withOptions([{ type: "budget_tokens", min: 1024, max: 8192 }]),
    );
    if (control?.kind !== "budget") throw new Error("expected budget control");
    expect(isReasoningValueValid(control, "none")).toBe(true);
    expect(isReasoningValueValid(control, "1024")).toBe(true);
    expect(isReasoningValueValid(control, "8192")).toBe(true);
    expect(isReasoningValueValid(control, "1023")).toBe(false);
    expect(isReasoningValueValid(control, "8193")).toBe(false);
    expect(isReasoningValueValid(control, "abc")).toBe(false);
    expect(isReasoningValueValid(control, "")).toBe(false);
    expect(isReasoningValueValid(control, "20.5")).toBe(false);
  });
});

describe("getReasoningControl toggle", () => {
  it("uses the provided on value and defaults to on", () => {
    expect(getReasoningControl(withOptions([{ type: "toggle", default: "high" }]))).toEqual({
      kind: "toggle",
      onValue: "high",
    });
    expect(getReasoningControl(withOptions([{ type: "toggle" }]))).toEqual({
      kind: "toggle",
      onValue: "on",
    });
  });

  it("only the on value is valid", () => {
    const control = getReasoningControl(withOptions([{ type: "toggle", default: "high" }]));
    if (control?.kind !== "toggle") throw new Error("expected toggle control");
    expect(isReasoningValueValid(control, "high")).toBe(true);
    expect(isReasoningValueValid(control, "none")).toBe(true);
    expect(isReasoningValueValid(control, "low")).toBe(false);
    expect(isReasoningValueValid(control, "")).toBe(false);
  });
});

describe("null vs undefined vs unknown types", () => {
  it("undefined (missing key) falls back to legacy metadata levels", () => {
    const caps = getModelCapabilities(withOptions(undefined));
    expect(caps.reasoningControl?.kind).toBe("effort");
    expect(caps.reasoningLevels).toEqual(["none", "low", "medium", "high"]);
  });

  it("explicit null hides the control", () => {
    expect(getReasoningControl(withOptions(null))).toBeNull();
    expect(getModelCapabilities(withOptions(null)).reasoningControl).toBeNull();
  });

  it("malformed (non-array) hides instead of crashing", () => {
    const bad = model() as unknown as Record<string, unknown>;
    bad.reasoning_options = "effort";
    expect(getReasoningControl(bad as unknown as AIModel)).toBeNull();
    expect(getReasoningControl(withOptions([]))).toBeNull();
  });

  it("skips unknown future types and uses the first recognized entry", () => {
    const control = getReasoningControl(
      withOptions([
        { type: "future-thing", values: ["z"] } as unknown as ReasoningOption,
        { type: "effort", values: ["a", "b"], default: "a" },
      ]),
    );
    expect(control).toEqual({ kind: "effort", levels: ["none", "a", "b"], defaultLevel: "a" });
    expect(
      getReasoningControl(withOptions([{ type: "nope" } as unknown as ReasoningOption])),
    ).toBeNull();
  });
});

describe("isReasoningValueValid / resolveReasoningValue", () => {
  it("effort only accepts listed levels", () => {
    const control = getReasoningControl(
      withOptions([{ type: "effort", values: ["low", "high"], default: "low" }]),
    );
    if (!control || control.kind !== "effort") throw new Error("expected effort control");
    expect(isReasoningValueValid(control, "low")).toBe(true);
    expect(isReasoningValueValid(control, "none")).toBe(true);
    expect(isReasoningValueValid(control, "medium")).toBe(false);
  });

  it("resolve keeps a valid stored value, else default, else the off switch", () => {
    const caps = getModelCapabilities(
      withOptions([{ type: "effort", values: ["low", "high"], default: "low" }]),
    );
    expect(resolveReasoningValue(caps, "high", "low")).toBe("high");
    expect(resolveReasoningValue(caps, "none", "low")).toBe("none");
    expect(resolveReasoningValue(caps, "nope", "high")).toBe("high");
    expect(resolveReasoningValue(caps, "nope", "nope")).toBe("low");
    expect(resolveReasoningValue(caps, "nope", "none")).toBe("none");
    expect(resolveReasoningValue(caps, null, null)).toBe("low");
    expect(resolveReasoningValue(getModelCapabilities(withOptions(null)), "high", "low")).toBeNull();
  });

  it("budget resolve falls back to the catalog default, honoring an explicit none", () => {
    const caps = getModelCapabilities(
      withOptions([{ type: "budget_tokens", min: 1, max: 10, default: "5" }]),
    );
    expect(resolveReasoningValue(caps, "7", null)).toBe("7");
    expect(resolveReasoningValue(caps, "none", null)).toBe("none");
    expect(resolveReasoningValue(caps, "99", null)).toBe("5");
    expect(resolveReasoningValue(caps, "99", "none")).toBe("none");
    expect(resolveReasoningValue(caps, null, "7")).toBe("5");
    // No catalog default: fresh resolves to the explicit off switch, not null,
    // so the budget display and the send payload agree.
    const noDefault = getModelCapabilities(
      withOptions([{ type: "budget_tokens", min: 1, max: 10 }]),
    );
    expect(resolveReasoningValue(noDefault, null, null)).toBe("none");
  });

  it("empty selection resolves to the model default, or the off switch without one", () => {
    const caps = getModelCapabilities(
      withOptions([{ type: "effort", values: ["low"], default: "low" }]),
    );
    expect(resolveReasoningValue(caps, null, null)).toBe("low");
    expect(defaultReasoningLevel(caps)).toBe("low");
    // Effort without a catalog default is explicitly off (never null), so a
    // fresh model shows None and sends "none".
    const noDefault = getModelCapabilities(withOptions([{ type: "effort", values: ["low"] }]));
    expect(resolveReasoningValue(noDefault, null, null)).toBe("none");
    expect(defaultReasoningLevel(noDefault)).toBeNull();
  });

  it("toggle resolves to the on value or the explicit off switch, never null", () => {
    const caps = getModelCapabilities(withOptions([{ type: "toggle", default: "high" }]));
    expect(resolveReasoningValue(caps, "high", null)).toBe("high");
    expect(resolveReasoningValue(caps, "none", "high")).toBe("none");
    expect(resolveReasoningValue(caps, null, "high")).toBe("high");
    expect(resolveReasoningValue(caps, null, "none")).toBe("none");
    expect(resolveReasoningValue(caps, null, null)).toBe("none");
    expect(defaultReasoningLevel(caps)).toBeNull();
  });
});

describe("per-model thinking levels (model switch)", () => {
  it("each model resolves its own stored level independently", () => {
    const effort = getModelCapabilities(
      withOptions([{ type: "effort", values: ["low", "high"], default: "low" }]),
    );
    const budget = getModelCapabilities(
      withOptions([{ type: "budget_tokens", min: 1, max: 10, default: "5" }]),
    );
    // Model A set to off, model B set to an on-level: switching preserves both.
    expect(resolveReasoningValue(effort, "none", null)).toBe("none");
    expect(resolveReasoningValue(budget, "7", null)).toBe("7");
    // A stale stored level (catalog changed since) falls back without leaking
    // into the other model.
    expect(resolveReasoningValue(effort, "ultra", "high")).toBe("high");
    expect(resolveReasoningValue(budget, "ultra", null)).toBe("5");
    // Displayed positions follow the resolved level: none is the first stop.
    if (effort.reasoningControl?.kind !== "effort") throw new Error("expected effort control");
    expect(effort.reasoningControl.levels.indexOf("none")).toBe(0);
    expect(effort.reasoningControl.levels.indexOf(resolveReasoningValue(effort, "none", null) as string)).toBe(0);
  });
});
