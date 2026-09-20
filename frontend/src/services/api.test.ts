import { afterEach, describe, expect, it, vi } from "vitest";
import { listProviders, streamChat, uploadChatAttachment } from "@/services/api";

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

describe("uploadChatAttachment (XHR progress)", () => {
  class FakeXHR {
    static instances: FakeXHR[] = [];
    upload = { onprogress: null as ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    status = 201;
    statusText = "Created";
    responseText = "";
    withCredentials = false;
    method = "";
    url = "";
    headers: Record<string, string> = {};

    constructor() {
      FakeXHR.instances.push(this);
    }

    open(method: string, url: string) {
      this.method = method;
      this.url = url;
    }

    setRequestHeader(name: string, value: string) {
      this.headers[name] = value;
    }

    send() {
      setTimeout(() => {
        this.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
        this.upload.onprogress?.({ lengthComputable: true, loaded: 100, total: 100 });
        this.responseText = JSON.stringify({
          attachment_id: "att-1",
          filename: "shot.png",
          mime_type: "image/png",
          kind: "image",
          size: 50,
        });
        this.onload?.();
      }, 0);
    }
  }

  afterEach(() => {
    FakeXHR.instances = [];
  });

  it("reports real upload progress and resolves the upload", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    const fractions: number[] = [];
    const result = await uploadChatAttachment(
      new File(["x".repeat(50)], "shot.png", { type: "image/png" }),
      "conv-1",
      (f) => fractions.push(f),
    );
    expect(result.attachment_id).toBe("att-1");
    expect(fractions).toEqual([0.5, 1]);
    const xhr = FakeXHR.instances[0];
    expect(xhr.method).toBe("POST");
    expect(xhr.url).toContain("/api/v1/chat/attachments");
    expect(xhr.withCredentials).toBe(true);
  });

  it("rejects with the server status on failure", async () => {
    class FailingXHR extends FakeXHR {
      send() {
        setTimeout(() => {
          this.status = 422;
          this.statusText = "Unprocessable Entity";
          this.responseText = '{"detail":"unsupported"}';
          this.onload?.();
        }, 0);
      }
    }
    vi.stubGlobal("XMLHttpRequest", FailingXHR);
    await expect(uploadChatAttachment(new File(["x"], "a.bin"), null)).rejects.toThrow(/422/);
  });
});
