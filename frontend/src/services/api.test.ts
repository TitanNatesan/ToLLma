import { afterEach, describe, expect, it, vi } from "vitest";
import { listProviders, streamChat } from "@/services/api";

const originalBackendUrl = process.env.BACKEND_URL;
const originalApiUrl = process.env.NEXT_PUBLIC_API_URL;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalBackendUrl !== undefined) {
    process.env.BACKEND_URL = originalBackendUrl;
  } else {
    delete process.env.BACKEND_URL;
  }
  if (originalApiUrl !== undefined) {
    process.env.NEXT_PUBLIC_API_URL = originalApiUrl;
  } else {
    delete process.env.NEXT_PUBLIC_API_URL;
  }
});

describe("api client", () => {
  it("builds provider list URL and parses JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: "1" }])));
    vi.stubGlobal("fetch", fetchMock);
    delete process.env.BACKEND_URL;
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
    let meta: unknown = null;
    let done: unknown = null;
    await streamChat(
      { provider_id: "p", model_id: "m", message: "hi" },
      {
        signal: new AbortController().signal,
        onMeta: (m) => (meta = m),
        onDelta: (d) => deltas.push(d),
        onDone: (d) => (done = d),
        onError: () => {},
      },
    );
    expect(meta).toMatchObject({ conversation_id: "c1" });
    expect(deltas.join("")).toBe("Hello world");
    expect(done).toMatchObject({ done: true });
  });

  it("routes snapshot events to onSnapshot (reattach)", async () => {
    const sse =
      'data: {"conversation_id": "c1", "generation_id": "g1", "message_id": "m1", "status": "running"}\n\n' +
      'data: {"content": "partial", "status": "running"}\n\n' +
      'data: {"delta": " rest"}\n\n' +
      'data: {"done": true, "generation_id": "g1", "message_id": "m1", "status": "completed"}\n\n';
    const stream = new ReadableStream({
      start: (c) => {
        c.enqueue(new TextEncoder().encode(sse));
        c.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream)));
    let snapshot = "";
    const deltas: string[] = [];
    let done: unknown = null;
    await streamChat(
      { provider_id: "p", model_id: "m", message: "hi" },
      {
        signal: new AbortController().signal,
        onSnapshot: (s) => (snapshot = s),
        onDelta: (d) => deltas.push(d),
        onDone: (d) => (done = d),
        onError: () => {},
      },
    );
    expect(snapshot).toBe("partial");
    expect(deltas.join("")).toBe(" rest");
    expect(done).toMatchObject({ done: true, status: "completed" });
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
