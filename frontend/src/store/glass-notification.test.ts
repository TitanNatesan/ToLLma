import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyGlassTheme, clampGlass } from "@/lib/glass";
import { DEFAULT_GLASS, NOTIFICATION_POSITIONS } from "@/store/glass";

describe("glass notificationPosition", () => {
  it("defaults to bottom-right", () => {
    expect(DEFAULT_GLASS.notificationPosition).toBe("bottom-right");
  });

  it("accepts every valid position", () => {
    for (const pos of NOTIFICATION_POSITIONS) {
      expect(clampGlass({ ...DEFAULT_GLASS, notificationPosition: pos }).notificationPosition).toBe(pos);
    }
  });

  it('falls back to bottom-right for junk', () => {
    for (const junk of ["top", "center", "", "BOTTOM-RIGHT", null, undefined, 42]) {
      const out = clampGlass({ ...DEFAULT_GLASS, notificationPosition: junk as never });
      expect(out.notificationPosition).toBe("bottom-right");
    }
  });
});

describe("glass blur clamp 0-100", () => {
  it("keeps 100 as 100", () => {
    expect(clampGlass({ ...DEFAULT_GLASS, blur: 100 }).blur).toBe(100);
  });

  it("clamps 150 to 100", () => {
    expect(clampGlass({ ...DEFAULT_GLASS, blur: 150 }).blur).toBe(100);
  });

  it("clamps negatives to 0", () => {
    expect(clampGlass({ ...DEFAULT_GLASS, blur: -10 }).blur).toBe(0);
  });
});

// applyGlassTheme targets <html> directly; vitest runs in node env so stub
// a minimal documentElement + getComputedStyle backed by a Map.
const g = globalThis as Record<string, unknown>;
let prevDocument: unknown;
let prevGetComputedStyle: unknown;

beforeEach(() => {
  prevDocument = g["document"];
  prevGetComputedStyle = g["getComputedStyle"];
  const vars = new Map<string, string>();
  const classes = new Set<string>();
  const root = {
    classList: {
      toggle: (cls: string, force?: boolean) => {
        if (force) classes.add(cls);
        else classes.delete(cls);
      },
      remove: (...cls: string[]) => {
        for (const c of cls) classes.delete(c);
      },
      contains: (cls: string) => classes.has(cls),
    },
    style: {
      setProperty: (k: string, v: string) => {
        vars.set(k, v);
      },
      getPropertyValue: (k: string) => vars.get(k) ?? "",
    },
  };
  g["document"] = { documentElement: root };
  g["getComputedStyle"] = () => ({
    getPropertyValue: (k: string) => vars.get(k) ?? "",
  });
});

afterEach(() => {
  if (prevDocument === undefined) delete g["document"];
  else g["document"] = prevDocument;
  if (prevGetComputedStyle === undefined) delete g["getComputedStyle"];
  else g["getComputedStyle"] = prevGetComputedStyle;
});

function glassBg(): string {
  const doc = g["document"] as { documentElement: unknown };
  const cs = g["getComputedStyle"] as (el: unknown) => { getPropertyValue(k: string): string };
  return cs(doc.documentElement).getPropertyValue("--glass-bg");
}

function glassVar(name: string): string {
  const doc = g["document"] as { documentElement: unknown };
  const cs = g["getComputedStyle"] as (el: unknown) => { getPropertyValue(k: string): string };
  return cs(doc.documentElement).getPropertyValue(name).trim();
}

describe("glass transparency extremes", () => {
  it("transparency 100 maps to alpha 0.02", () => {
    applyGlassTheme({ ...DEFAULT_GLASS, transparencyEnabled: true, transparency: 100, appearance: "dark" });
    expect(glassBg()).toContain("/ 0.02");
  });

  it("transparency 0 maps to alpha 1", () => {
    applyGlassTheme({ ...DEFAULT_GLASS, transparencyEnabled: true, transparency: 0, appearance: "dark" });
    expect(glassBg()).toContain("/ 1)");
  });

  it("disabled transparency maps to alpha 0.97", () => {
    applyGlassTheme({ ...DEFAULT_GLASS, transparencyEnabled: false, transparency: 100 });
    expect(glassBg()).toContain("/ 0.97");
  });
});

describe("glass appearance two-mode (black merged into dark)", () => {
  function rootClasses(): { contains(c: string): boolean } {
    const doc = g["document"] as {
      documentElement: { classList: { contains(c: string): boolean } };
    };
    return doc.documentElement.classList;
  }

  it("dark carries the deep-black palette with no black class", () => {
    applyGlassTheme({ ...DEFAULT_GLASS, appearance: "dark" });
    expect(rootClasses().contains("dark")).toBe(true);
    expect(rootClasses().contains("black")).toBe(false);
    expect(glassBg()).toContain("0 0 0");
  });

  it('clamps legacy "black" to the dark default', () => {
    const out = clampGlass({ ...DEFAULT_GLASS, appearance: "black" as never });
    expect(out.appearance).toBe("dark");
  });

  it("legacy black input applies as dark with no black class", () => {
    applyGlassTheme({ ...DEFAULT_GLASS, appearance: "black" as never });
    expect(rootClasses().contains("dark")).toBe(true);
    expect(rootClasses().contains("black")).toBe(false);
    expect(glassBg()).toContain("0 0 0");
  });
});

describe("glass refraction smoothstep", () => {
  it("maps 100 to 0.3", () => {
    applyGlassTheme({ ...DEFAULT_GLASS, transparencyEnabled: true, refraction: 100 });
    expect(glassVar("--glass-highlight")).toBe("0.3");
  });

  it("maps 0 to 0", () => {
    applyGlassTheme({ ...DEFAULT_GLASS, transparencyEnabled: true, refraction: 0 });
    expect(glassVar("--glass-highlight")).toBe("0");
  });

  it("maps 25 along the smoothstep curve (not linear)", () => {
    // h=0.25 -> s=h*h*(3-2h)=0.15625 -> 0.3*s=0.046875 -> round3 "0.047"
    // (a linear 0.3*h mapping would give 0.075 instead).
    applyGlassTheme({ ...DEFAULT_GLASS, transparencyEnabled: true, refraction: 25 });
    expect(glassVar("--glass-highlight")).toBe("0.047");
  });
});
