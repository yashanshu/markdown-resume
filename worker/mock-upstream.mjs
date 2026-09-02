import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_PORT ?? 9988);
const KEY = "mock-key";

const server = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    if (req.headers.authorization !== `Bearer ${KEY}`) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "bad upstream key" }));
      return;
    }
    if (req.method === "GET" && req.url === "/v1/models") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "mock-model" }] }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      const parsed = JSON.parse(body || "{}");
      if (parsed.stream) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(
          `data: ${JSON.stringify({ choices: [{ delta: { content: "mock " } }] })}\n\n`
        );
        res.write(
          `data: ${JSON.stringify({ choices: [{ delta: { content: "reply" } }] })}\n\n`
        );
        res.write("data: [DONE]\n\n");
        res.end();
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            choices: [{ message: { role: "assistant", content: "mock reply" } }]
          })
        );
      }
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });
});

server.listen(PORT, "127.0.0.1", () => console.log(`mock upstream on 127.0.0.1:${PORT}`));
