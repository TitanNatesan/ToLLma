import { describe, expect, it } from "vitest";

import {
  fmtBytes,
  fmtCompact,
  fmtMoney,
  fmtMs,
  fmtNumber,
  fmtPct,
  fmtPercent,
  fmtRate,
  toNumber,
  truncateLabel,
} from "../components/format";

describe("toNumber", () => {
  it("accepts numbers and API decimal strings", () => {
    expect(toNumber("3.75")).toBe(3.75);
    expect(toNumber(12)).toBe(12);
    expect(toNumber(null)).toBe(0);
    expect(toNumber("nope")).toBe(0);
  });
});

describe("fmtMoney", () => {
  it("keeps sub-cent precision for small spend", () => {
    expect(fmtMoney(0)).toBe("$0");
    expect(fmtMoney("0.00012")).toBe("$0.0001");
    expect(fmtMoney("0.1167")).toBe("$0.117");
    expect(fmtMoney("12.5")).toBe("$12.50");
  });
});

describe("fmtCompact / fmtNumber", () => {
  it("compacts thousands and millions", () => {
    expect(fmtCompact(999)).toBe("999");
    expect(fmtCompact(1_500)).toBe("1.5k");
    expect(fmtCompact(2_400_000)).toBe("2.4M");
    expect(fmtNumber(1234)).toBe("1,234");
  });
});

describe("rate vs percent", () => {
  it("scales fractions for fmtRate and leaves percents alone", () => {
    expect(fmtRate(0.0736)).toBe("7.4%");
    expect(fmtPercent(7.36)).toBe("7.4%");
    expect(fmtPct(12.5)).toBe("+12.5%");
    expect(fmtPct(null)).toBe("—");
  });
});

describe("fmtMs / fmtBytes / truncateLabel", () => {
  it("formats durations", () => {
    expect(fmtMs(250)).toBe("250ms");
    expect(fmtMs(2_500)).toBe("2.50s");
    expect(fmtMs(null)).toBe("—");
  });
  it("formats byte sizes", () => {
    expect(fmtBytes(0)).toBe("0 B");
    expect(fmtBytes(2048)).toBe("2.0 KB");
  });
  it("truncates long model labels", () => {
    expect(truncateLabel("a-very-long-model-name-here", 10)).toBe("a-very-lo…");
    expect(truncateLabel("short", 10)).toBe("short");
  });
});
