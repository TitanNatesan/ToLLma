import { afterEach, describe, expect, it, vi } from "vitest";
import { listProviders, streamChat } from "@/services/api";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.NEXT_PUBLIC_API_URL;
});

describe("api client", () => {
  it("builds provider list URL and parses JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: "1" }])));
    vi.stubGlobal("fetch", fetchMock);
    process.env.NEXT_PUBLIC_API_URL = "http://api:8000";
    const providers = await listProviders();
    expect(fetchMock).toHaveBeenCalledWith("http://api:8000/api/v1/providers", expect.anything());
    expect(providers).toEqual([{ id: "1" }]);
  });

  it("parses SSE deltas, meta and done events", async () => {
    const sse =
      'data: {"conversation_id": "c1"}\n\n' +
      'data: {"delta": "Hello"}\n\n' +
      'data: {"delta": " world"}\n\n' +
      'data: {"done": true, "usage": {"prompt_tokens": 1, "completion_tokens": 2, "total_tokens": 3}}\n\n';
    const stream = new ReadableStream({
      start: (c) => {
        c.enqueue(new TextEncoder().encode(sse));
        c.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream)));
    const deltas: string[] = [];
    let meta = "";
    let done: unknown = null;
    await streamChat(
      { provider_id: "p", model_id: "m", message: "hi" },
      {
        signal: new AbortController().signal,
        onMeta: (id) => (meta = id),
        onDelta: (d) => deltas.push(d),
        onDone: (d) => (done = d),
        onError: () => {},
      },
    );
    expect(meta).toBe("c1");
    expect(deltas.join("")).toBe("Hello world");
    expect(done).toMatchObject({ done: true });
  });

  it("surfaces provider errors", async () => {
    const stream = new ReadableStream({
      start: (c) => {
        c.enqueue(new TextEncoder().encode('data: {"error": "boom"}\n\n'));
        c.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream)));
    let err = "";
    await streamChat(
      { provider_id: "p", model_id: "m", message: "hi" },
      {
        signal: new AbortController().signal,
        onDelta: () => {},
        onDone: () => {},
        onError: (m) => (err = m),
      },
    );
    expect(err).toBe("boom");
  });
});
