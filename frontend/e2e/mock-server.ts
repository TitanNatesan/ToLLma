import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

let server: Server | null = null;

/** Minimal OpenAI-compatible mock: /models + streaming /chat/completions with usage. */
export async function startMockLLM(port = 4899): Promise<string> {
  if (server) return `http://localhost:${port}`;
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.url?.startsWith("/models")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "mock-model" }] }));
      return;
    }
    if (req.url === "/chat/completions" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const parsed = JSON.parse(body || "{}");
        if (parsed.stream) {
          res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
          res.write('data: {"choices": [{"delta": {"content": "Hello from **mock** "}}]}\n\n');
          res.write('data: {"choices": [{"delta": {"content": "`code`"}}]}\n\n');
          res.write(
            'data: {"choices": [{"delta": {}}], "usage": {"prompt_tokens": 8, "completion_tokens": 6, "total_tokens": 14}}\n\n',
          );
          res.write("data: [DONE]\n\n");
          res.end();
        } else {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              choices: [{ message: { role: "assistant", content: "Hello" } }],
              usage: { prompt_tokens: 8, completion_tokens: 6, total_tokens: 14 },
            }),
          );
        }
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve, reject) => {
    server!.once("error", (e: unknown) => {
      const err = e as { code?: string };
      if (err.code === "EADDRINUSE") resolve(); // already running (shared worker)
      else reject(e);
    });
    server!.listen(port, resolve);
  });
  return `http://localhost:${port}`;
}
