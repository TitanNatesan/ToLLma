import { describe, expect, it, vi, beforeEach } from "vitest";
import React from "react";

vi.mock("sileo", () => ({
  sileo: {
    show: vi.fn(() => "show-id"),
    success: vi.fn(() => "success-id"),
    error: vi.fn(() => "error-id"),
    warning: vi.fn(() => "warning-id"),
    info: vi.fn(() => "info-id"),
    action: vi.fn(() => "action-id"),
    promise: vi.fn((p: Promise<unknown>) => p),
    dismiss: vi.fn(),
    clear: vi.fn(),
  },
  Toaster: () => null,
}));

import { sileo } from "sileo";
import { toast } from "../notify";

beforeEach(() => vi.clearAllMocks());

describe("notify adapter", () => {
  it("maps success/error/warning/info to titled sileo calls", () => {
    expect(toast.success("Saved")).toBe("success-id");
    expect(sileo.success).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Saved" }),
    );
    toast.error("Broke", { description: "details here" });
    expect(sileo.error).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Broke", description: "details here" }),
    );
    toast.warning("Careful");
    expect(sileo.warning).toHaveBeenCalledTimes(1);
    toast.info("FYI");
    expect(sileo.info).toHaveBeenCalledTimes(1);
  });

  it("renders node messages as the toast body", () => {
    const node = React.createElement("span", null, "hi");
    toast.warning(node);
    expect(sileo.warning).toHaveBeenCalledWith(
      expect.objectContaining({ title: undefined, description: node }),
    );
  });

  it("maps sonner-style actions to sileo buttons", () => {
    const onClick = vi.fn();
    toast.error("Failed", { action: { label: "Retry", onClick } });
    expect(sileo.error).toHaveBeenCalledWith(
      expect.objectContaining({ button: { title: "Retry", onClick } }),
    );
  });

  it("renders contrast toasts with solid fills and white text", () => {
    toast.success("Ready", {
      description: "done elsewhere",
      action: { label: "Open", onClick: () => {} },
      contrast: true,
    });
    expect(sileo.success).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Ready",
        fill: "#055b08",
        styles: expect.objectContaining({
          title: "text-white!",
          description: "text-white!",
        }),
      }),
    );
    const btn = (sileo.success as ReturnType<typeof vi.fn>).mock.calls[0][0].button;
    expect(btn.title).toBe("Open");
    toast.error("Broke", { contrast: true });
    expect(sileo.error).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Broke", fill: "#b91c1c" }),
    );
  });

  it("leaves non-contrast toasts on theme defaults", () => {
    toast.success("Plain");
    expect(sileo.success).toHaveBeenCalledWith(
      expect.not.objectContaining({ fill: expect.anything() }),
    );
  });

  it("fires exactly one underlying toast per call (no duplicates)", () => {
    toast.success("Once");
    const total =
      (sileo.success as ReturnType<typeof vi.fn>).mock.calls.length +
      (sileo.error as ReturnType<typeof vi.fn>).mock.calls.length +
      (sileo.show as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(total).toBe(1);
  });

  it("maps promise string/function forms to sileo options", async () => {
    const result = await toast.promise(Promise.resolve(42), {
      loading: "Working",
      success: (n) => `Got ${n}`,
      error: "Broke",
    });
    expect(result).toBe(42);
    expect(sileo.promise).toHaveBeenCalledWith(
      expect.any(Promise),
      {
        loading: { title: "Working" },
        success: expect.any(Function),
        error: expect.any(Function),
      },
    );
  });

  it("dismiss without id clears all toasts", () => {
    toast.dismiss("abc");
    expect(sileo.dismiss).toHaveBeenCalledWith("abc");
    toast.dismiss();
    expect(sileo.clear).toHaveBeenCalledTimes(1);
  });
});
