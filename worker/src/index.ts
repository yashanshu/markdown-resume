interface Env {
  DB: D1Database;
  PROXY_TOKEN: string;
  GO_API_KEY: string;
  OPENROUTER_API_KEY: string;
  GO_BASE_URL?: string;
  OPENROUTER_BASE_URL?: string;
  SITE_ORIGIN?: string;
  DAILY_REQUEST_CAP?: string;
}

interface SessionRow {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: number;
  role: string;
  content: string;
  created_at: string;
}

type Cors = Record<string, string>;

const DEFAULTS = {
  go: "https://opencode.ai/zen/go/v1",
  openrouter: "https://openrouter.ai/api/v1",
  siteOrigin: "https://resume.hasufel.shop",
  dailyCap: "200"
};

function upstreamFor(env: Env, name: string) {
  if (name === "go") {
    return { baseUrl: env.GO_BASE_URL ?? DEFAULTS.go, apiKey: env.GO_API_KEY };
  }
  if (name === "openrouter") {
    return {
      baseUrl: env.OPENROUTER_BASE_URL ?? DEFAULTS.openrouter,
      apiKey: env.OPENROUTER_API_KEY
    };
  }
  return null;
}

function checkOrigin(request: Request, env: Env): boolean {
  const origin = request.headers.get("Origin") ?? request.headers.get("Referer");
  if (!origin) return true;
  const allowed = (env.SITE_ORIGIN ?? DEFAULTS.siteOrigin)
    .split(",")
    .map((s) => s.trim());
  try {
    return allowed.includes(new URL(origin).origin);
  } catch {
    return false;
  }
}

function corsHeaders(request: Request, env: Env): Cors {
  const origin = request.headers.get("Origin");
  if (!origin || !checkOrigin(request, env)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
}

function json(status: number, body: unknown, cors: Cors = {}): Response {
  const headers = new Headers({ "Content-Type": "application/json", ...cors });
  return new Response(JSON.stringify(body), { status, headers });
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value = await request.json();
    return typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function countRequest(
  env: Env,
  upstream: string,
  cors: Cors
): Promise<Response | null> {
  const cap = Number(env.DAILY_REQUEST_CAP ?? DEFAULTS.dailyCap);
  if (!Number.isFinite(cap) || cap <= 0)
    return json(503, { error: "invalid DAILY_REQUEST_CAP" }, cors);
  const day = new Date().toISOString().slice(0, 10);
  try {
    const { results } = await env.DB.prepare(
      `INSERT INTO request_counts (upstream, day, count) VALUES (?, ?, 1)
       ON CONFLICT (upstream, day) DO UPDATE SET count = count + 1 WHERE count + 1 <= ?
       RETURNING count`
    )
      .bind(upstream, day, cap)
      .all<{ count: number }>();
    if (!results.length)
      return json(429, { error: `daily request cap reached for ${upstream}` }, cors);
    return null;
  } catch {
    return json(503, { error: "request counter unavailable" }, cors);
  }
}

async function proxy(
  upstream: string,
  route: string,
  request: Request,
  env: Env,
  cors: Cors
): Promise<Response> {
  const cfg = upstreamFor(env, upstream);
  if (!cfg) return json(404, { error: "unknown upstream" }, cors);
  if (!cfg.apiKey)
    return json(503, { error: `${upstream} upstream not configured` }, cors);

  if (route === "chat/completions") {
    const limited = await countRequest(env, upstream, cors);
    if (limited) return limited;
  }

  const headers = new Headers();
  headers.set("Content-Type", request.headers.get("Content-Type") ?? "application/json");
  headers.set("Authorization", `Bearer ${cfg.apiKey}`);
  const accept = request.headers.get("Accept");
  if (accept) headers.set("Accept", accept);

  const url = `${cfg.baseUrl.replace(/\/+$/, "")}/${route}`;
  const body = request.method === "GET" ? undefined : await request.text();
  const upstreamRes = await fetch(url, { method: request.method, headers, body });

  const res = new Response(upstreamRes.body, upstreamRes);
  for (const [key, value] of Object.entries(cors)) res.headers.set(key, value);
  return res;
}

async function listSessions(env: Env, cors: Cors): Promise<Response> {
  const { results } = await env.DB.prepare(
    "SELECT id, title, created_at, updated_at FROM sessions ORDER BY updated_at DESC"
  ).all<SessionRow>();
  return json(200, results, cors);
}

async function createSession(request: Request, env: Env, cors: Cors): Promise<Response> {
  const body = await readJson(request);
  if (!body) return json(400, { error: "invalid JSON body" }, cors);
  const title = typeof body.title === "string" ? body.title.slice(0, 500) : "";
  const row = await env.DB.prepare(
    "INSERT INTO sessions (id, title) VALUES (?, ?) RETURNING id, title, created_at, updated_at"
  )
    .bind(crypto.randomUUID(), title)
    .first<SessionRow>();
  return json(201, row, cors);
}

async function updateSession(
  id: string,
  request: Request,
  env: Env,
  cors: Cors
): Promise<Response> {
  const body = await readJson(request);
  if (!body || typeof body.title !== "string")
    return json(400, { error: "title (string) required" }, cors);
  const row = await env.DB.prepare(
    "UPDATE sessions SET title = ?, updated_at = datetime('now') WHERE id = ? RETURNING id, title, created_at, updated_at"
  )
    .bind(body.title.slice(0, 500), id)
    .first<SessionRow>();
  if (!row) return json(404, { error: "session not found" }, cors);
  return json(200, row, cors);
}

async function deleteSession(id: string, env: Env, cors: Cors): Promise<Response> {
  const result = await env.DB.batch([
    env.DB.prepare("DELETE FROM messages WHERE session_id = ?").bind(id),
    env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(id)
  ]);
  if (!result[1].meta.changes) return json(404, { error: "session not found" }, cors);
  return json(200, { ok: true }, cors);
}

async function listMessages(id: string, env: Env, cors: Cors): Promise<Response> {
  const { results } = await env.DB.prepare(
    "SELECT id, role, content, created_at FROM messages WHERE session_id = ? ORDER BY id"
  )
    .bind(id)
    .all<MessageRow>();
  if (!results.length) {
    const session = await env.DB.prepare("SELECT id FROM sessions WHERE id = ?")
      .bind(id)
      .first();
    if (!session) return json(404, { error: "session not found" }, cors);
  }
  return json(200, results, cors);
}

async function addMessages(
  id: string,
  request: Request,
  env: Env,
  cors: Cors
): Promise<Response> {
  const body = await readJson(request);
  const messages = body?.messages;
  const valid =
    Array.isArray(messages) &&
    messages.length > 0 &&
    messages.every(
      (m) =>
        m !== null &&
        typeof m === "object" &&
        typeof (m as Record<string, unknown>).content === "string" &&
        ["user", "assistant", "system"].includes(
          (m as Record<string, unknown>).role as string
        )
    );
  if (!valid) {
    return json(
      400,
      { error: "messages: [{ role: user|assistant|system, content: string }] required" },
      cors
    );
  }
  const session = await env.DB.prepare("SELECT id FROM sessions WHERE id = ?")
    .bind(id)
    .first();
  if (!session) return json(404, { error: "session not found" }, cors);
  await env.DB.batch([
    ...(messages as { role: string; content: string }[]).map((m) =>
      env.DB.prepare(
        "INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)"
      ).bind(id, m.role, m.content)
    ),
    env.DB.prepare("UPDATE sessions SET updated_at = datetime('now') WHERE id = ?").bind(
      id
    )
  ]);
  return json(201, { inserted: messages.length }, cors);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(request, env);

    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers: cors });

    if (!checkOrigin(request, env))
      return json(403, { error: "origin not allowed" }, cors);

    const auth = request.headers.get("Authorization");
    if (!env.PROXY_TOKEN || auth !== `Bearer ${env.PROXY_TOKEN}`)
      return json(401, { error: "unauthorized" }, cors);

    const { pathname } = new URL(request.url);
    const method = request.method;

    try {
      if (pathname === "/sessions") {
        if (method === "GET") return await listSessions(env, cors);
        if (method === "POST") return await createSession(request, env, cors);
      }

      const session = pathname.match(/^\/sessions\/([^/]+)$/);
      if (session) {
        if (method === "PATCH")
          return await updateSession(session[1], request, env, cors);
        if (method === "DELETE") return await deleteSession(session[1], env, cors);
      }

      const messages = pathname.match(/^\/sessions\/([^/]+)\/messages$/);
      if (messages) {
        if (method === "GET") return await listMessages(messages[1], env, cors);
        if (method === "POST") return await addMessages(messages[1], request, env, cors);
      }

      const passthrough = pathname.match(
        /^\/(go|openrouter)\/v1\/(chat\/completions|models)$/
      );
      if (passthrough)
        return await proxy(passthrough[1], passthrough[2], request, env, cors);

      return json(404, { error: "not found" }, cors);
    } catch {
      return json(500, { error: "internal error" }, cors);
    }
  }
};
