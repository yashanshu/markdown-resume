/**
 * Sprint 3 local checks: runAgentTurn against a mock OpenAI-compatible SSE
 * upstream, plus pure helper checks. Run: pnpm verify:ai
 */
import { createServer } from "node:http";
import {
  MAX_TOOL_ITERATIONS,
  applySuggestion,
  extractSuggestion,
  runAgentTurn,
  type AgentEvent,
  type AgentNoticeCode
} from "./src/utils/ai";
const PORT = 9989;
const TOKEN = "mock-token";

let failures = 0;
const check = (name: string, ok: boolean, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${ok ? "" : ` ${extra}`}`);
  if (!ok) failures++;
};

const sse = (res: import("node:http").ServerResponse, chunks: object[]) => {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
};

const textChunks = (text: string) => [
  { choices: [{ delta: { role: "assistant", content: text.slice(0, 5) } }] },
  { choices: [{ delta: { content: text.slice(5) } }] },
  { choices: [{ delta: {}, finish_reason: "stop" }] }
];

const toolCallChunks = (args: object) => [
  {
    choices: [
      {
        delta: {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: "call_1",
              type: "function",
              function: { name: "set_resume", arguments: "" }
            }
          ]
        }
      }
    ]
  },
  {
    choices: [
      {
        delta: {
          tool_calls: [{ index: 0, function: { arguments: JSON.stringify(args) } }]
        }
      }
    ]
  },
  { choices: [{ delta: {}, finish_reason: "tool_calls" }] }
];

const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.headers.authorization !== `Bearer ${TOKEN}`) {
      res.writeHead(401).end("{}");
      return;
    }
    const parsed = JSON.parse(body || "{}");

    if (parsed.model === "no-tools-model" && parsed.tools?.length) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: { message: "this model does not support tools or function calling" }
        })
      );
      return;
    }
    if (parsed.model === "editor-model") {
      if (parsed.messages.some((m: { role: string }) => m.role === "tool")) {
        sse(res, textChunks("Done: resume updated."));
      } else {
        sse(res, toolCallChunks({ markdown: "# Updated Resume\n\nFresh content." }));
      }
      return;
    }
    if (parsed.model === "loopy-model") {
      sse(res, toolCallChunks({ markdown: `# Attempt\n\nagain.` }));
      return;
    }
    if (parsed.model === "suggester-model") {
      sse(
        res,
        textChunks(
          "Try this:\n```markdown\n# Experience\n\n- New job at ACME\n```\nGood luck."
        )
      );
      return;
    }
    sse(res, textChunks("mock reply"));
  });
});

const run = (opts: Partial<Parameters<typeof runAgentTurn>[0]>) =>
  runAgentTurn({
    provider: "go",
    model: "text-model",
    token: TOKEN,
    mode: "suggest",
    messages: [],
    userText: "hi",
    getResume: () => "# Resume\n\nold",
    writeResume: () => true,
    apiBaseUrl: `http://127.0.0.1:${PORT}`,
    ...opts
  });

const noticesOf = (events: AgentEvent[]): AgentNoticeCode[] =>
  events.flatMap((e) => (e.type === "notice" ? [e.code] : []));

const main = async () => {
  await new Promise<void>((r) => server.listen(PORT, "127.0.0.1", r));

  // 1. plain turn, suggest mode: no tools offered, reply streamed
  const events1: AgentEvent[] = [];
  const r1 = await run({
    model: "text-model",
    onEvent: (e) => events1.push(e)
  });
  check(
    "plain reply text",
    r1.assistantText === "mock reply",
    JSON.stringify(r1.assistantText)
  );
  check("suggest mode never writes", r1.wroteResume === false);
  check("history extends by user+assistant", r1.messages.length === 2);
  check(
    "deltas streamed in order",
    events1.filter((e) => e.type === "text-delta").length >= 2
  );

  // 2. auto-edit turn: model calls set_resume, write goes through, summary follows
  const events2: AgentEvent[] = [];
  let written: string | null = null;
  const r2 = await run({
    model: "editor-model",
    mode: "auto-edit",
    getResume: () => "# Old Resume\n\nold",
    writeResume: async (md) => {
      written = md;
      return true;
    },
    onEvent: (e) => events2.push(e)
  });
  check(
    "set_resume write received",
    written === "# Updated Resume\n\nFresh content.",
    String(written)
  );
  check("wroteResume flag", r2.wroteResume === true);
  check(
    "tool-write event fired",
    events2.some((e) => e.type === "tool-write")
  );
  check(
    "final text after tool round",
    r2.assistantText === "Done: resume updated.",
    JSON.stringify(r2.assistantText)
  );
  check(
    "tool roundtrips kept in history",
    r2.messages.some((m) => m.role === "tool")
  );

  // 3. blocked write: snapshot fails -> model told, no write flag
  const r3 = await run({
    model: "editor-model",
    mode: "auto-edit",
    writeResume: () => false
  });
  check("failed snapshot blocks write", r3.wroteResume === false);

  // 4. runaway tool loop: capped at MAX_TOOL_ITERATIONS with a notice
  const events4: AgentEvent[] = [];
  const r4 = await run({
    model: "loopy-model",
    mode: "auto-edit",
    onEvent: (e) => events4.push(e)
  });
  check(
    "loop capped at max iterations",
    r4.messages.length <= 2 + 2 * MAX_TOOL_ITERATIONS,
    String(r4.messages.length)
  );
  check("loop-abort notice fired", noticesOf(events4).includes("loop-abort"));

  // 5. tool-unsupported model: degrade to a plain reply with a notice
  const events5: AgentEvent[] = [];
  const r5 = await run({
    model: "no-tools-model",
    mode: "auto-edit",
    onEvent: (e) => events5.push(e)
  });
  check("degraded flag set", r5.degraded === true);
  check("degraded notice fired", noticesOf(events5).includes("degraded"));
  check(
    "degraded still replies",
    r5.assistantText === "mock reply",
    JSON.stringify(r5.assistantText)
  );

  // 6. suggest flow: snippet extraction + apply by heading / append
  const r6 = await run({ model: "suggester-model" });
  const snippet = extractSuggestion(r6.assistantText);
  check(
    "snippet extracted from fence",
    snippet === "# Experience\n\n- New job at ACME",
    JSON.stringify(snippet)
  );
  const doc = "# Resume\n\nintro\n\n# Experience\n\n- Old job\n\n# Education\n\nschool";
  const applied = applySuggestion(doc, snippet!);
  check(
    "apply replaces section by heading",
    applied ===
      "# Resume\n\nintro\n\n# Experience\n\n- New job at ACME\n\n# Education\n\nschool",
    JSON.stringify(applied)
  );
  check(
    "apply appends when heading absent",
    applySuggestion("# A\n\nx", "# New\n\ny") === "# A\n\nx\n\n# New\n\ny"
  );
  check("extract null without fence", extractSuggestion("no code here") === null);

  server.close();
  console.log();
  if (failures) {
    console.log(`${failures} CHECK(S) FAILED`);
    process.exit(1);
  }
  console.log("ALL CHECKS PASSED");
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
