import { describe, expect, it } from "vitest";
import {
  REASONING_OFF_LEVEL,
  cycleReasoningLevel,
  normalizeReasoningLevels,
  stepReasoningLevel,
} from "../reasoningLevels";

const LEVELS = ["none", "low", "medium", "high"];

describe("normalizeReasoningLevels", () => {
  it("prepends none to the declared levels", () => {
    expect(normalizeReasoningLevels(["low", "medium", "high"])).toEqual(LEVELS);
  });

  it("forces none first even when declared mid-list, dropping duplicates", () => {
    expect(normalizeReasoningLevels(["low", "none", "high", "low"])).toEqual([
      "none",
      "low",
      "high",
    ]);
  });

  it("drops blank levels", () => {
    expect(normalizeReasoningLevels(["", "low", ""])).toEqual(["none", "low"]);
  });
});

describe("cycleReasoningLevel (click)", () => {
  it("follows None → Low → Medium → High → None", () => {
    expect(cycleReasoningLevel(LEVELS, REASONING_OFF_LEVEL)).toBe("low");
    expect(cycleReasoningLevel(LEVELS, "low")).toBe("medium");
    expect(cycleReasoningLevel(LEVELS, "medium")).toBe("high");
    expect(cycleReasoningLevel(LEVELS, "high")).toBe("none");
  });

  it("supports the reverse direction", () => {
    expect(cycleReasoningLevel(LEVELS, "none", -1)).toBe("high");
    expect(cycleReasoningLevel(LEVELS, "low", -1)).toBe("none");
  });

  it("starts at the first level for unknown values and yields null without levels", () => {
    expect(cycleReasoningLevel(LEVELS, "bogus")).toBe("low");
    expect(cycleReasoningLevel([], "low")).toBeNull();
  });
});

describe("stepReasoningLevel (wheel/keyboard)", () => {
  it("steps one level per direction", () => {
    expect(stepReasoningLevel(LEVELS, "none", 1)).toBe("low");
    expect(stepReasoningLevel(LEVELS, "medium", 1)).toBe("high");
    expect(stepReasoningLevel(LEVELS, "high", -1)).toBe("medium");
    expect(stepReasoningLevel(LEVELS, "low", -1)).toBe("none");
  });

  it("clamps at both ends instead of wrapping", () => {
    expect(stepReasoningLevel(LEVELS, "high", 1)).toBe("high");
    expect(stepReasoningLevel(LEVELS, "none", -1)).toBe("none");
  });

  it("yields null without levels", () => {
    expect(stepReasoningLevel([], "low", 1)).toBeNull();
  });
});
