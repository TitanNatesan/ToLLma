import { describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { extractText } from "../ResponseMarkdown";

describe("ResponseMarkdown utilities", () => {
  it("extracts text from strings and nested nodes", () => {
    expect(extractText("hello world")).toBe("hello world");
    expect(extractText(123)).toBe("123");
    expect(extractText(["hello", " ", "world"])).toBe("hello world");
    expect(
      extractText({
        props: {
          children: ["deep", " ", "text"],
        },
      } as unknown as ReactNode),
    ).toBe("deep text");
  });

  it("handles empty or null nodes safely", () => {
    expect(extractText(null)).toBe("");
    expect(extractText(undefined)).toBe("");
    expect(extractText("")).toBe("");
  });
});
