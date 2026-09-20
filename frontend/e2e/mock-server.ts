import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

let server: Server | null = null;

/** Minimal OpenAI-compatible mock: /models + streaming /chat/completions with usage. */
export async function startMockLLM(port = 4899): Promise<string> {
  if (server) return `http://localhost:${port}`;
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.url?.startsWith("/models")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "mock-disc-a" }, { id: "mock-disc-b" }] }));
      return;
    }
    if (req.url === "/chat/completions" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const parsed = JSON.parse(body || "{}");
        if (parsed.stream) {
          res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
          // Slow mode (model id contains "slow"): 20 paced chunks so tests can
          // stop mid-stream and refresh mid-generation. Production-only path.
          if (typeof parsed.model === "string" && parsed.model.includes("slow")) {
            let i = 0;
            const timer = setInterval(() => {
              i += 1;
              if (i <= 20) {
                res.write(`data: {"choices": [{"delta": {"content": "slow-word-${i} "}}]}\n\n`);
              } else {
                clearInterval(timer);
                res.write(
                  'data: {"choices": [{"delta": {}}], "usage": {"prompt_tokens": 8, "completion_tokens": 6, "total_tokens": 14}}\n\n',
                );
                res.write("data: [DONE]\n\n");
                res.end();
              }
            }, 150);
            return;
          }
          // Thinking mode (model id contains "think"): paced reasoning_content
          // deltas first (DeepSeek/OpenRouter/Bedrock-normalized shape), then
          // the final answer — lets tests observe the Thinking pill streaming
          // before any answer text exists.
          if (typeof parsed.model === "string" && parsed.model.includes("think")) {
            res.write('data: {"choices": [{"delta": {"reasoning_content": "Considering "}}]}\n\n');
            setTimeout(() => {
              res.write('data: {"choices": [{"delta": {"reasoning_content": "the options "}}]}\n\n');
            }, 400);
            setTimeout(() => {
              res.write('data: {"choices": [{"delta": {"reasoning_content": "carefully."}}]}\n\n');
            }, 800);
            setTimeout(() => {
              res.write('data: {"choices": [{"delta": {"content": "Thoughtful answer."}}]}\n\n');
              res.write(
                'data: {"choices": [{"delta": {}}], "usage": {"prompt_tokens": 8, "completion_tokens": 6, "total_tokens": 14}}\n\n',
              );
              res.write("data: [DONE]\n\n");
              res.end();
            }, 2400);
            return;
          }
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
    server!.listen(port, "0.0.0.0", resolve);
  });
  return `http://localhost:${port}`;
}
