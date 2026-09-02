import * as localForage from "localforage";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { jsonSchema, stepCountIs, streamText, tool, type ModelMessage } from "ai";
import {
  AI_API_BASE_URL,
  getAiHistory,
  type AiAgentMode,
  type AiProvider
} from "./aiSettings";

export const MAX_TOOL_ITERATIONS = 8;

const UNDO_STACK_KEY = "ai-undo-stack";
const SESSION_KEY = "ai-chat-session-id";

export interface UndoSnapshot {
  resumeId: string | null;
  markdown: string;
  ts: number;
}

/**
 * Snapshot stack for undoing AI writes. Returns false when storage fails so
 * callers can block the write (never write without a snapshot).
 */
export const pushUndoSnapshot = async (snap: UndoSnapshot): Promise<boolean> => {
  try {
    const stack = (await localForage.getItem<UndoSnapshot[]>(UNDO_STACK_KEY)) ?? [];
    stack.push(snap);
    await localForage.setItem(UNDO_STACK_KEY, stack.slice(-20));
    return true;
  } catch {
    return false;
  }
};

export const popUndoSnapshot = async (): Promise<UndoSnapshot | null> => {
  try {
    const stack = (await localForage.getItem<UndoSnapshot[]>(UNDO_STACK_KEY)) ?? [];
    const last = stack.pop() ?? null;
    await localForage.setItem(UNDO_STACK_KEY, stack);
    return last;
  } catch {
    return null;
  }
};

/**
 * Apply a suggested snippet: if it starts with a heading that exists in the
 * document, replace that whole section; otherwise append at the end.
 */
export const applySuggestion = (doc: string, snippet: string): string => {
  const text = snippet.trim();
  if (!text) return doc;

  const firstLine = text.split("\n", 1)[0].trim();
  const heading = firstLine.match(/^(#{1,6})\s+\S.*$/);
  const docLines = doc.split("\n");

  if (heading) {
    const idx = docLines.findIndex((l) => l.trim() === firstLine);
    if (idx !== -1) {
      const level = heading[1].length;
      let end = docLines.length;
      for (let i = idx + 1; i < docLines.length; i++) {
        if (new RegExp(`^#{1,${level}}\\s`).test(docLines[i])) {
          end = i;
          break;
        }
      }
      const replacement = text.split("\n");
      if (end < docLines.length && replacement[replacement.length - 1] !== "")
        replacement.push("");
      return [...docLines.slice(0, idx), ...replacement, ...docLines.slice(end)].join(
        "\n"
      );
    }
  }

  if (!doc) return text;
  return doc.endsWith("\n") ? doc + text : doc + "\n\n" + text;
};

/** First fenced code block in an assistant reply, else null. */
export const extractSuggestion = (text: string): string | null => {
  const m = text.match(/```(?:markdown|md)?[^\n]*\n([\s\S]*?)```/);
  return m ? m[1].trim() : null;
};

export type AgentNoticeCode =
  | "loop-abort"
  | "degraded"
  | "error"
  | "bad-token"
  | "bad-endpoint"
  | "rate-limit"
  | "model-error";

/**
 * Map a worker/upstream error to a notice code: 401 = missing/wrong proxy
 * token, 429/402 = rate or credit limit, 400 = the model rejected the
 * request, 403/404/5xx/unreachable = endpoint problem, anything else stays
 * generic. Retryable statuses are unwrapped from the SDK's RetryError first.
 */
export const agentErrorNoticeCode = (error: unknown): AgentNoticeCode => {
  const e = error as { statusCode?: unknown; message?: unknown; lastError?: unknown };
  // retryable statuses (429/5xx) arrive wrapped in a RetryError after SDK retries
  if (e?.lastError) return agentErrorNoticeCode(e.lastError);
  const status = typeof e?.statusCode === "number" ? e.statusCode : undefined;
  if (status === 401) return "bad-token";
  if (status === 429 || status === 402) return "rate-limit";
  if (status === 400) return "model-error";
  if (status === 403 || status === 404 || (status ?? 0) >= 500) return "bad-endpoint";
  if (/fetch|network|ENOTFOUND|ECONNREFUSED|timeout/i.test(String(e?.message ?? "")))
    return "bad-endpoint";
  return "error";
};

export type AgentEvent =
  | { type: "text-delta"; text: string }
  | { type: "tool-write" }
  | { type: "notice"; code: AgentNoticeCode; detail?: string };

export interface AgentTurnOptions {
  provider: AiProvider;
  model: string;
  token: string;
  mode: AiAgentMode;
  messages: ModelMessage[];
  userText: string;
  getResume: () => string;
  /**
   * Caller-provided write path. Must snapshot the current resume first and
   * return false when the snapshot fails (the write is then skipped).
   */
  writeResume: (markdown: string) => Promise<boolean> | boolean;
  signal?: AbortSignal;
  onEvent?: (event: AgentEvent) => void;
  apiBaseUrl?: string;
}

export interface AgentTurnResult {
  messages: ModelMessage[];
  assistantText: string;
  wroteResume: boolean;
  degraded: boolean;
}

const systemPrompt = (resume: string, mode: AiAgentMode): string => {
  const shared = `You are an assistant embedded in a Markdown resume editor. The user is iterating on their resume.

The current resume in full:
<resume>
${resume}
</resume>`;

  if (mode === "auto-edit") {
    return `${shared}

You can edit the resume with the set_resume tool. It replaces the ENTIRE document, so always pass the complete updated resume, never a fragment or a diff. Make focused changes and leave untouched sections as they are. After editing, reply with a short summary of what you changed.`;
  }

  return `${shared}

You cannot edit the document. Give advice, and when you propose concrete text, put each complete replacement snippet in a fenced \`\`\`markdown code block starting with the heading of the section it replaces.`;
};

// ponytail: heuristic "model can't tool-call" detection — upstream 400s word it
// differently; if this misses, the fenced-snippet path still catches the case
const isToolUnsupported = (error: unknown): boolean =>
  error instanceof Error && /tool|function/i.test(error.message);

/**
 * One agent turn: send the conversation (plus a system prompt containing the
 * resume), stream the reply, run tool calls (auto-edit only), and return the
 * extended message history. Aborts after MAX_TOOL_ITERATIONS steps.
 */
export const runAgentTurn = async (opts: AgentTurnOptions): Promise<AgentTurnResult> => {
  const client = createOpenAICompatible({
    name: opts.provider,
    baseURL: `${opts.apiBaseUrl ?? AI_API_BASE_URL}/${opts.provider}/v1`,
    apiKey: opts.token
  });

  const autoEdit = opts.mode === "auto-edit";
  let wroteResume = false;

  const tools = autoEdit
    ? {
        set_resume: tool({
          description:
            "Replace the entire resume markdown with the full updated document.",
          inputSchema: jsonSchema<{ markdown: string }>({
            type: "object",
            properties: { markdown: { type: "string" } },
            required: ["markdown"],
            additionalProperties: false
          }),
          execute: async ({ markdown }) => {
            const ok = await opts.writeResume(markdown);
            if (!ok) return "Error: snapshot failed, the resume was not changed.";
            wroteResume = true;
            opts.onEvent?.({ type: "tool-write" });
            return "The resume was updated.";
          }
        })
      }
    : undefined;

  const attempt = async (withTools: boolean) => {
    let assistantText = "";
    let streamError: unknown;

    const result = streamText({
      model: client.chatModel(opts.model),
      system: systemPrompt(opts.getResume(), opts.mode),
      messages: [...opts.messages, { role: "user", content: opts.userText }],
      tools: withTools ? tools : undefined,
      stopWhen: stepCountIs(MAX_TOOL_ITERATIONS),
      abortSignal: opts.signal,
      // errors are surfaced via fullStream "error" parts; this keeps them out of the console
      onError: () => {}
    });

    for await (const part of result.fullStream) {
      if (part.type === "text-delta") {
        assistantText += part.text;
        opts.onEvent?.({ type: "text-delta", text: part.text });
      } else if (part.type === "error") {
        streamError = part.error;
      }
    }

    let steps = 0;
    try {
      steps = (await result.steps).length;
    } catch {}

    return { result, assistantText, streamError, steps };
  };

  let { result, assistantText, streamError, steps } = await attempt(autoEdit);
  let degraded = false;

  // A model that rejects tool parameters: retry once without tools (suggest behavior)
  if (
    streamError &&
    !opts.signal?.aborted &&
    autoEdit &&
    isToolUnsupported(streamError)
  ) {
    degraded = true;
    opts.onEvent?.({ type: "notice", code: "degraded" });
    ({ result, assistantText, streamError, steps } = await attempt(false));
  }

  if (streamError && !opts.signal?.aborted) {
    opts.onEvent?.({
      type: "notice",
      code: agentErrorNoticeCode(streamError),
      detail: streamError instanceof Error ? streamError.message : String(streamError)
    });
  }

  if (!streamError && steps >= MAX_TOOL_ITERATIONS) {
    opts.onEvent?.({ type: "notice", code: "loop-abort" });
  }

  let responseMessages: ModelMessage[] = [];
  try {
    responseMessages = (await result.responseMessages) as ModelMessage[];
  } catch {}

  // Keep history valid even when the stream errored mid-turn
  const fallback: ModelMessage[] = assistantText
    ? [{ role: "assistant", content: assistantText }]
    : [];

  return {
    messages: [
      ...opts.messages,
      { role: "user", content: opts.userText },
      ...(responseMessages.length ? responseMessages : fallback)
    ],
    assistantText,
    wroteResume,
    degraded
  };
};

/**
 * ---- Chat history (worker API, server mode; all best-effort) ----
 */

export const ensureAiSession = async (
  token: string,
  apiBaseUrl?: string
): Promise<string> => {
  const existing = localStorage.getItem(SESSION_KEY);
  if (existing) return existing;
  const res = await fetch(`${apiBaseUrl ?? AI_API_BASE_URL}/sessions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Resume chat" })
  });
  if (!res.ok) throw new Error(`session create failed: ${res.status}`);
  const session = (await res.json()) as { id: string };
  localStorage.setItem(SESSION_KEY, session.id);
  return session.id;
};

export const saveAiTurn = async (
  token: string,
  sessionId: string,
  userText: string,
  assistantText: string,
  apiBaseUrl?: string
): Promise<void> => {
  await fetch(`${apiBaseUrl ?? AI_API_BASE_URL}/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [
        { role: "user", content: userText },
        { role: "assistant", content: assistantText }
      ]
    })
  });
};

export const loadAiHistory = async (
  token: string,
  apiBaseUrl?: string
): Promise<Array<{ role: "user" | "assistant"; content: string }>> => {
  const sessionId = localStorage.getItem(SESSION_KEY);
  if (!sessionId) return [];
  const res = await fetch(
    `${apiBaseUrl ?? AI_API_BASE_URL}/sessions/${sessionId}/messages`,
    {
      headers: { Authorization: `Bearer ${token}` }
    }
  );
  if (!res.ok) return [];
  const rows = (await res.json()) as Array<{ role: string; content: string }>;
  return rows
    .filter((r) => r.role === "user" || r.role === "assistant")
    .map((r) => ({ role: r.role as "user" | "assistant", content: r.content }));
};

export const aiHistoryEnabled = (): boolean => getAiHistory() === "server";
