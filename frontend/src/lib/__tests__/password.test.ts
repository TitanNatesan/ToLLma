import { describe, expect, it } from "vitest";
import { passwordStrength } from "../password";

describe("passwordStrength", () => {
  it("flags short passwords as too weak", () => {
    const result = passwordStrength("abc");
    expect(result.score).toBe(0);
    expect(result.label).toBe("Too weak");
    expect(result.hints).toContain("Use at least 8 characters");
  });

  it("scores longer mixed passwords higher", () => {
    const fair = passwordStrength("password123");
    const strong = passwordStrength("Str0ng!Password42");
    expect(fair.score).toBeGreaterThan(0);
    expect(strong.score).toBe(4);
    expect(strong.label).toBe("Strong");
  });

  it("suggests missing character classes", () => {
    const result = passwordStrength("lowercaseonly");
    expect(result.hints).toContain("Add an uppercase letter");
    expect(result.hints).toContain("Add a number");
  });
});
