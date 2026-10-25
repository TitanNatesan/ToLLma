import { describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { extractText, normalizeMathDelimiters, rehypeCitations } from "../ResponseMarkdown";

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

interface HastStub {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastStub[];
}

function paragraph(value: string): HastStub {
  return {
    type: "root",
    children: [
      { type: "element", tagName: "p", properties: {}, children: [{ type: "text", value }] },
    ],
  };
}

describe("rehypeCitations", () => {
  it("splits [n] markers into citation sup nodes with 1-based indexes", () => {
    const tree = paragraph("According to the PDF [1] and the CSV [2].");
    rehypeCitations({ maxIndex: 2 })(tree);

    const children = tree.children![0].children!;
    expect(children.map((node) => node.type)).toEqual([
      "text",
      "element",
      "text",
      "element",
      "text",
    ]);
    expect(children[1]).toMatchObject({
      tagName: "sup",
      properties: { "data-citation-index": 1 },
    });
    expect(children[3]).toMatchObject({
      tagName: "sup",
      properties: { "data-citation-index": 2 },
    });
  });

  it("ignores markers above maxIndex and leaves code subtrees untouched", () => {
    const plain = paragraph("no source for [9] here");
    rehypeCitations({ maxIndex: 1 })(plain);
    expect(plain.children![0].children).toHaveLength(1);

    const code: HastStub = {
      type: "root",
      children: [
        { type: "element", tagName: "code", properties: {}, children: [{ type: "text", value: "x[1]" }] },
      ],
    };
    rehypeCitations({ maxIndex: 3 })(code);
    expect(code.children![0].children).toEqual([{ type: "text", value: "x[1]" }]);
  });
});

describe("normalizeMathDelimiters", () => {
  it("converts display \\[...\\] to $$...$$", () => {
    expect(normalizeMathDelimiters("Speed: \\[v = 220\\ \\text{km}\\] fast")).toBe(
      "Speed: $$v = 220\\ \\text{km}$$ fast",
    );
  });

  it("converts multi-line display math", () => {
    expect(normalizeMathDelimiters("\\[\n  C = 2\\pi R\n\\]")).toBe("$$\n  C = 2\\pi R\n$$");
  });

  it("converts inline \\(...\\) to $...$", () => {
    expect(normalizeMathDelimiters("a \\(x^2\\) b")).toBe("a $x^2$ b");
  });

  it("leaves fenced code blocks untouched", () => {
    const src = "text \\[a\\]\n```latex\n\\[b\\]\n```\ntail \\(c\\)";
    expect(normalizeMathDelimiters(src)).toBe("text $$a$$\n```latex\n\\[b\\]\n```\ntail $c$");
  });

  it("leaves inline code untouched", () => {
    expect(normalizeMathDelimiters("use `\\[x\\]` here and \\(y\\)")).toBe(
      "use `\\[x\\]` here and $y$",
    );
  });

  it("leaves unmatched delimiters (mid-stream) and escaped brackets alone", () => {
    expect(normalizeMathDelimiters("partial \\[x^2 + 1")).toBe("partial \\[x^2 + 1");
    expect(normalizeMathDelimiters("literal \\\\[x]")).toBe("literal \\\\[x]");
  });

  it("leaves dollar math and plain text unchanged", () => {
    expect(normalizeMathDelimiters("$a^2$ and $$b$$ plain")).toBe("$a^2$ and $$b$$ plain");
  });
});
