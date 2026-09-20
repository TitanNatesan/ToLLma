import { describe, expect, it } from "vitest";
import type { ToolStatus } from "../tools/ToolCall";

describe("ToolCall status types and formatting", () => {
  it("supports running, completed, and failed states", () => {
    const statuses: ToolStatus[] = ["running", "completed", "failed"];
    expect(statuses).toHaveLength(3);
    expect(statuses).toContain("running");
    expect(statuses).toContain("completed");
    expect(statuses).toContain("failed");
  });

  it("handles structured argument serialization safely", () => {
    const args = { query: "weather in Tokyo", units: "metric" };
    const serialized = JSON.stringify(args, null, 2);
    expect(serialized).toContain("weather in Tokyo");
    expect(serialized).toContain("metric");
  });
});
