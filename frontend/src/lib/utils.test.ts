import { describe, expect, it } from "vitest";
import { cn, fmtCompactTokens, fmtCost, fmtPrice, fmtTokens, stripTrailingZeros } from "@/lib/utils";

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

describe("fmtCost", () => {
  it("strips trailing zeros from spec examples", () => {
    expect(fmtCost("1.3500000")).toBe("$1.35");
    expect(fmtCost("0.001000")).toBe("$0.001");
    expect(fmtCost("$5.000000")).toBe("$5");
    expect(fmtCost("0.000000")).toBe("$0");
    expect(fmtCost(null)).toBe("$0");
    expect(fmtCost("200.000")).toBe("$200");
  });
});

describe("fmtTokens", () => {
  it("groups integers with no decimals", () => {
    expect(fmtTokens(200)).toBe("200");
    expect(fmtTokens(200.0)).toBe("200");
    expect(fmtTokens(954)).toBe("954");
    expect(fmtTokens(1234567)).toBe("1,234,567");
  });
});

describe("fmtCompactTokens", () => {
  it("compacts context windows", () => {
    expect(fmtCompactTokens(200000)).toBe("200k");
    expect(fmtCompactTokens(64000)).toBe("64k");
    expect(fmtCompactTokens(1500)).toBe("1.5k");
    expect(fmtCompactTokens(950)).toBe("950");
  });
});
