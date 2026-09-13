import { describe, expect, it } from "vitest";
import { cn, fmtPrice, stripTrailingZeros } from "@/lib/utils";

describe("cn", () => {
  it("joins truthy classes", () => {
    expect(cn("a", "b")).toBe("a b");
  });
  it("drops falsy parts", () => {
    expect(cn("a", false, null, undefined, "b")).toBe("a b");
  });
});

describe("stripTrailingZeros", () => {
  it("strips trailing zeros after decimal point", () => {
    expect(stripTrailingZeros("1.000000000000")).toBe("1");
    expect(stripTrailingZeros("5.000000000000")).toBe("5");
    expect(stripTrailingZeros("0.100000000000")).toBe("0.1");
    expect(stripTrailingZeros("1.250000000000")).toBe("1.25");
    expect(stripTrailingZeros("0.000000000000")).toBe("0");
    expect(stripTrailingZeros("0")).toBe("0");
    expect(stripTrailingZeros("100")).toBe("100");
    expect(stripTrailingZeros(null)).toBe("0");
  });
});

describe("fmtPrice", () => {
  it("formats prices without unwanted zeros", () => {
    expect(fmtPrice("1.000000000000")).toBe("$1");
    expect(fmtPrice("5.000000000000")).toBe("$5");
    expect(fmtPrice("0.100000000000")).toBe("$0.1");
    expect(fmtPrice("1.250000000000")).toBe("$1.25");
    expect(fmtPrice("0.000000000000")).toBe("$0");
    expect(fmtPrice("0")).toBe("$0");
  });
});
