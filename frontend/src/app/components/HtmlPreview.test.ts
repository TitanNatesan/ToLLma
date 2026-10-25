import { describe, expect, it } from "vitest";
import {
  PREVIEW_CSP,
  PREVIEW_DEVICES,
  isPreviewableLanguage,
  preparePreviewDocument,
} from "./HtmlPreview";

describe("HTML preview eligibility", () => {
  it("allows only html/htm code cells", () => {
    expect(isPreviewableLanguage("html")).toBe(true);
    expect(isPreviewableLanguage("htm")).toBe(true);
    expect(isPreviewableLanguage("HTML")).toBe(true);
    expect(isPreviewableLanguage("python")).toBe(false);
    expect(isPreviewableLanguage("javascript")).toBe(false);
    expect(isPreviewableLanguage("json")).toBe(false);
    expect(isPreviewableLanguage("css")).toBe(false);
    expect(isPreviewableLanguage("markdown")).toBe(false);
    expect(isPreviewableLanguage("")).toBe(false);
    expect(isPreviewableLanguage(undefined)).toBe(false);
    expect(isPreviewableLanguage(null)).toBe(false);
  });
});

describe("preview device widths", () => {
  it("exposes phone, tablet, and desktop viewports", () => {
    const byId = Object.fromEntries(PREVIEW_DEVICES.map((d) => [d.id, d.width]));
    expect(byId.phone).toBe(390);
    expect(byId.tablet).toBe(768);
    expect(byId.desktop).toBe(1280);
    for (const device of PREVIEW_DEVICES) {
      expect(device.width).toBeGreaterThan(0);
    }
  });
});

describe("preview sandbox policy", () => {
  it("denies scripts, same-origin, popups, and navigation", () => {
    expect(PREVIEW_CSP).toContain("script-src 'none'");
    expect(PREVIEW_CSP).toContain("default-src 'none'");
    expect(PREVIEW_CSP).toContain("form-action 'none'");
    expect(PREVIEW_CSP).toContain("frame-src 'none'");
    expect(PREVIEW_CSP).not.toContain("allow-scripts");
    expect(PREVIEW_CSP).not.toContain("allow-same-origin");
  });
});

describe("preparePreviewDocument", () => {
  it("reports unavailability without a DOM", () => {
    // Node unit env has no DOMParser: the contract is a shaped error, never a throw.
    const result = preparePreviewDocument("<p>hi</p>");
    expect(result).toEqual({ error: "Preview is unavailable in this environment." });
  });
});
