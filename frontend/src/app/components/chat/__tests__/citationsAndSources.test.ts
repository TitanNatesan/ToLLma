import { describe, expect, it } from "vitest";
import type { CitationSource } from "../citations/InlineCitation";
import { deriveSources } from "../sources/Sources";
import type { ChatAttachment, ChatMessage } from "@/types";

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

function attachment(id: string, filename: string): ChatAttachment {
  return {
    id,
    filename,
    mime_type: "application/pdf",
    kind: "document",
    file_size: 1024,
    conversation_id: null,
    message_id: null,
    created_at: "2026-09-21T00:00:00Z",
  };
}

function turn(
  id: string,
  role: ChatMessage["role"],
  attachments?: ChatAttachment[],
): ChatMessage {
  return { id, role, content: "", attachments } as unknown as ChatMessage;
}

describe("deriveSources", () => {
  it("maps a user turn's attachments onto the reply it produced, 1-indexed", () => {
    const map = deriveSources([
      turn("u1", "user", [attachment("a1", "report.pdf"), attachment("a2", "sales.csv")]),
      turn("a1", "assistant"),
    ]);

    const sources = map.get("a1");
    expect(sources?.map((source) => source.title)).toEqual(["report.pdf", "sales.csv"]);
    expect(sources?.map((source) => source.index)).toEqual([1, 2]);
    expect(sources?.[0].kind).toBe("file");
    expect(sources?.[0].url).toContain("a1");
    expect(map.get("u1")).toBeUndefined();
  });

  it("does not leak an earlier turn's attachments into a later reply", () => {
    const map = deriveSources([
      turn("u1", "user", [attachment("a1", "report.pdf")]),
      turn("a1", "assistant"),
      turn("u2", "user"),
      turn("a2", "assistant"),
    ]);

    expect(map.has("a1")).toBe(true);
    expect(map.has("a2")).toBe(false);
  });
});
