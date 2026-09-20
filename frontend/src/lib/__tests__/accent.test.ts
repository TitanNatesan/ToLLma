import { describe, expect, it } from "vitest";
import {
  ACCENT_BASES,
  ACCENT_ORDER,
  accentVars,
  HEX_COLOR_RE,
  hexToHsl,
  resolveAccentBase,
} from "../accent";

describe("accentVars", () => {
  it("keeps the base color at 500 and emits the full scale", () => {
    const vars = accentVars("#066e09");
    expect(vars["--color-tollma-500"]).toBe("#066e09");
    for (const shade of ["50", "100", "200", "300", "400", "600", "700", "800", "900", "950"]) {
      expect(vars[`--color-tollma-${shade}`]).toMatch(HEX_COLOR_RE);
    }
  });

  it("darkens monotonically from 500 to 950", () => {
    const lightness = (hex: string) => hexToHsl(hex).l;
    const vars = accentVars("#1d4ed8");
    const chain = ["500", "600", "700", "800", "900", "950"].map((s) => lightness(vars[`--color-tollma-${s}`]));
    for (let i = 1; i < chain.length; i++) {
      expect(chain[i]).toBeLessThan(chain[i - 1]);
    }
  });

  it("keeps light shades lighter than dark shades for every preset accent", () => {
    for (const name of ACCENT_ORDER) {
      const vars = accentVars(ACCENT_BASES[name]);
      expect(hexToHsl(vars["--color-tollma-50"]).l).toBeGreaterThan(hexToHsl(vars["--color-tollma-950"]).l);
    }
  });

  it("falls back to the brand green for invalid input", () => {
    expect(accentVars("nope")["--color-tollma-500"]).toBe(ACCENT_BASES.green);
  });
});

describe("resolveAccentBase", () => {
  it("resolves presets and valid custom hex", () => {
    expect(resolveAccentBase("blue", null)).toBe(ACCENT_BASES.blue);
    expect(resolveAccentBase("custom", "#AA00FF")).toBe("#aa00ff");
  });

  it("falls back for a custom accent without a valid color", () => {
    expect(resolveAccentBase("custom", null)).toBe(ACCENT_BASES.green);
    expect(resolveAccentBase("custom", "not-a-color")).toBe(ACCENT_BASES.green);
  });
});
