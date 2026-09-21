import { describe, expect, it } from "vitest";
import { ApiError } from "@/services/api";
import { parseApiError } from "../errors";

describe("parseApiError", () => {
  it("extracts the structured error envelope", () => {
    const error = new ApiError(502, "Bad Gateway", {
      success: false,
      error: { code: "TIMEOUT", message: "Provider request timed out.", retryable: true, timestamp: "t" },
    }, "raw");
    const parsed = parseApiError(error);
    expect(parsed.code).toBe("TIMEOUT");
    expect(parsed.message).toBe("Provider request timed out.");
    expect(parsed.retryable).toBe(true);
    expect(parsed.status).toBe(502);
  });

  it("falls back to an actionable message for unknown codes", () => {
    const error = new ApiError(500, "Server Error", { success: false, error: { code: "DATABASE_ERROR" } }, "raw");
    const parsed = parseApiError(error);
    expect(parsed.code).toBe("DATABASE_ERROR");
    expect(parsed.message).toContain("database");
    expect(parsed.message).not.toContain("raw");
  });

  it("never surfaces a raw stack trace for plain errors", () => {
    const parsed = parseApiError(new Error("boom"));
    expect(parsed.code).toBe("UNKNOWN_ERROR");
    expect(parsed.retryable).toBe(true);
  });
});
