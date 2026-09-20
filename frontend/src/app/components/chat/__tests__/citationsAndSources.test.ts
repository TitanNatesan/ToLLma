import { describe, expect, it } from "vitest";
import type { CitationSource } from "../citations/InlineCitation";

describe("CitationSource metadata contract", () => {
  it("structures citation source attributes correctly", () => {
    const webSource: CitationSource = {
      id: "src-1",
      index: 1,
      title: "FastAPI Documentation",
      url: "https://fastapi.tiangolo.com",
      snippet: "FastAPI framework, high performance, easy to learn.",
      author: "Sebastián Ramírez",
      kind: "web",
    };

    expect(webSource.index).toBe(1);
    expect(webSource.kind).toBe("web");
    expect(webSource.url).toContain("https://");
  });

  it("handles local file and document source formats", () => {
    const fileSource: CitationSource = {
      id: "doc-1",
      index: 2,
      title: "architecture.pdf",
      snippet: "System design specs for ToLLma gateway.",
      kind: "document",
    };

    expect(fileSource.index).toBe(2);
    expect(fileSource.kind).toBe("document");
    expect(fileSource.url).toBeUndefined();
  });
});
