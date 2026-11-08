import { describe, expect, it } from "vitest";
import { shouldStallTwinFetch } from "../useIntelligence";

describe("shouldStallTwinFetch", () => {
  it("stalls only while streaming with a live user echo", () => {
    expect(shouldStallTwinFetch(true, [{ role: "user" }])).toBe(true);
  });
  it("does not stall when idle, even with an echo", () => {
    expect(shouldStallTwinFetch(false, [{ role: "user" }])).toBe(false);
  });
  it("does not stall mid-stream without a user echo (recovery/regenerate)", () => {
    expect(shouldStallTwinFetch(true, [])).toBe(false);
    expect(shouldStallTwinFetch(true, [{ role: "assistant" }])).toBe(false);
  });
  it("does not stall when idle and empty", () => {
    expect(shouldStallTwinFetch(false, [])).toBe(false);
  });
});
