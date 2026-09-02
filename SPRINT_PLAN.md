# AI Agent Integration — Sprint Plan (DRAFT)

Status: Sprint 4 code-complete — items 2 (README setup docs), 3 (Privacy/About AI honesty pass) and 4 (error notices: missing/bad token, bad endpoint, rate limit, model 400) shipped. Local checks all green: `pnpm build` passes, 27/27 in `site/` (`pnpm verify:ai`), 20/20 in `worker/` (`./verify.sh mock`). Remaining are the two owner-machine steps: item 1 deploy (wrangler auth + secrets + Pages) and item 5 live end-to-end on both upstreams — run the panel against the deployed worker, or `worker/verify.sh real` with real keys in `worker/.dev.vars`.

## Decisions

- **Agent role**: chat panel beside the editor with a user-selectable mode:
  - **auto-edit** — agent can read and rewrite the resume markdown via tool calls; changes show in live preview
  - **suggest** — agent never writes; it proposes snippets with an "Apply" button, the user triggers the write
- **Access**: proxy only, owner use — the AI panel activates when the owner pastes the `PROXY_TOKEN` in Settings. Public users see no AI features. BYOK is deferred (see bottom).
- **Providers**: two named upstreams behind the same worker, client-selected:
  - **go** — OpenCode Go (`https://opencode.ai/zen/go/v1`), subscription-backed
  - **openrouter** — OpenRouter (`https://openrouter.ai/api/v1`), credit-backed, for models Go doesn't carry
  - Both speak OpenAI `/chat/completions`. The worker forwards to whichever the client picks — still a dumb pipe: the client chooses upstream and model; no fallback, no routing, no normalization (that's OpenRouter's job, not ours)
- **Chat history**: D1 (server) or off, selectable in Settings
- **Tool loop**: Vercel AI SDK (`ai` package). Hand-rolling SSE tool-call accumulation is where the cross-provider bugs live (fragmented `tool_calls` deltas, missing `finish_reason`, errors inside HTTP 200 bodies).

## Architecture

- **Cloudflare only, $0**:
  - Pages hosts the static site at `resume.hasufel.shop`
  - Worker at `api.resume.hasufel.shop` with D1 (free tier: 5 GB storage, 25k writes/day)
- **Worker** = OpenAI-compatible passthrough + small history API:
  - Routes `/:upstream/v1/chat/completions` and `/:upstream/v1/models` where `:upstream` is `go` or `openrouter`; prefix stripped, request forwarded untouched with that upstream's key
  - Wrangler secrets: `GO_API_KEY`, `OPENROUTER_API_KEY`, `PROXY_TOKEN` (bearer token checked by the worker; pasted once into Settings on owner machines)
  - Wrangler vars, defaults in code: `GO_BASE_URL`, `OPENROUTER_BASE_URL`
- **Tooling**: `worker/` is a package in the pnpm workspace — wrangler as devDependency, `pnpm dev` / `pnpm run deploy` scripts. All commands via pnpm; wrangler auth, secrets, and deploys run on the owner's machine, never from the agent or CI.
- **Worker guards**:
  - reject requests whose `Origin`/`Referer` is not the site
  - daily request cap per upstream (D1 counter) that fails closed — OpenRouter is metered billing, so a leaked token or runaway loop hits a wall
- **History routes**: `GET/POST /sessions`, `PATCH/DELETE /sessions/:id`, `GET/POST /sessions/:id/messages` — two tables (`sessions`, `messages`), one write per completed turn
- **Client Settings** fields: token, provider (go / openrouter), model, agent mode (auto-edit / suggest), history storage (server / off)
- **Privacy model**: resume content in AI chats transits the worker (to Go or OpenRouter) and history lands in D1 — an explicit exception to the README's "nothing is uploaded" promise, stated plainly on the Privacy/About pages. Public users never see the AI panel. The worker never logs message bodies.

## Sprints

### Sprint 1 — Worker + D1 foundation (~1 evening)

1. `worker/` package in the pnpm workspace: `wrangler.toml` (free tier), D1 schema (`sessions`, `messages`)
2. Passthrough `POST /:upstream/v1/chat/completions`: token check, Origin check, streaming piped through untouched
3. Passthrough `GET /:upstream/v1/models`
4. History endpoints: the six routes above
5. Daily request cap per upstream that fails closed
6. Verify: `pnpm dev` in `worker/` + curl script — completion round-trips against both Go (e.g. `glm-5.1`) and OpenRouter (e.g. `anthropic/claude-sonnet-4.6`), both model lists return, a session is saved and read back

### Sprint 2 — Settings + store (~1 evening)

1. AI section in `site/src/pages/[...lang]/settings.vue` + settings store: token, provider, model, agent mode, history storage
2. Model dropdown re-fetched from the selected provider's `/v1/models` when the provider changes
3. Verify: values survive page reload

### Sprint 3 — Chat panel + agent loop (core, ~a weekend)

1. `site/src/components/edit/AiChat.vue` panel in the editor: message list, input, streaming output
2. `site/src/utils/ai.ts`: Vercel AI SDK request builder + tool loop, tools `get_resume` / `set_resume`
3. Guards:
   - `MAX_TOOL_ITERATIONS = 8`; abort with an explanatory message
   - snapshot the resume in IndexedDB before every `set_resume` write; offer undo
   - if the model can't tool-call, degrade to suggest mode with a notice
4. Suggest mode: no write tool offered; "Apply" uses replace-section-by-heading or append-at-cursor (never find-replace — snippets never match the document exactly)
5. History wiring: worker API in server mode, nothing in off mode
6. Verify end-to-end on both upstreams:
   - auto-edit updates the resume and the live preview; undo restores the previous version
   - suggest mode cannot write to the document
   - the loop-abort fires on a prompt that begs for repetition

### Sprint 4 — Deploy + honesty pass (~1 evening)

1. Deploy (manual, on the owner's machine): site → Cloudflare Pages; worker → `pnpm run deploy` in `worker/`, then custom domain `api.resume.hasufel.shop`
2. **Done** — README: setup docs (deploy worker, configure secrets, Settings walkthrough)
3. **Done** — Privacy + About pages: AI section — owner-only, what transits (Go/OpenRouter), what's stored (D1 history), and the blanket "never transmitted" claims qualified
4. **Done** — Error toasts: missing token, bad endpoint, rate limit, model 400 (some Go models are Anthropic-upstream — point the user at another model)
5. Verify: live at `resume.hasufel.shop`, chat works over the internet on both upstreams, `pnpm build` passes (build verified locally; the live half waits on item 1)

## Out of scope (for now)

- Per-user accounts / auth on the proxy (single bearer token only)
- Streaming changes to partial document edits (full-document `set_resume` + snapshot/undo instead of patch machinery)
- Any non-OpenAI-compatible provider APIs
- Multi-provider routing / fallback / key management inside the worker — solved upstream by OpenRouter and the Go gateway; a "mini-OpenRouter" is a separate project that already exists (OpenRouter managed, LiteLLM self-hosted)
- `opencode serve` as a backend — its session/SDK protocol and host-file tools don't fit a browser document editor; the Go gateway is the supported piece of opencode

## Deferred

- **BYOK** (base URL + key + preset fields, localforage history, localhost/browser caveats) — revisit if a public release with AI for everyone is on the table; the passthrough worker already serves it unchanged
