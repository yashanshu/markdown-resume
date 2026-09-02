#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-mock}"
PORT="${PORT:-8787}"
MOCK_PORT="${MOCK_PORT:-9988}"
TOKEN="dev-token"
BASE="http://127.0.0.1:${PORT}"
ORIGIN="https://resume.hasufel.shop"
AUTH="Authorization: Bearer ${TOKEN}"
JSON="Content-Type: application/json"
MODEL_GO="${MODEL_GO:-glm-5.1}"
MODEL_OR="${MODEL_OR:-anthropic/claude-sonnet-4.6}"

cd "$(dirname "$0")"

WRANGLER_PID=""
MOCK_PID=""
cleanup() {
  [ -n "$WRANGLER_PID" ] && pkill -P "$WRANGLER_PID" 2>/dev/null || true
  [ -n "$WRANGLER_PID" ] && kill "$WRANGLER_PID" 2>/dev/null || true
  [ -n "$MOCK_PID" ] && kill "$MOCK_PID" 2>/dev/null || true
}
trap cleanup EXIT

if [ "$MODE" = "mock" ]; then
  cat > .dev.vars <<EOF
PROXY_TOKEN=${TOKEN}
GO_API_KEY=mock-key
OPENROUTER_API_KEY=mock-key
GO_BASE_URL=http://127.0.0.1:${MOCK_PORT}/v1
OPENROUTER_BASE_URL=http://127.0.0.1:${MOCK_PORT}/v1
DAILY_REQUEST_CAP=5
EOF
  MOCK_PORT="$MOCK_PORT" node mock-upstream.mjs > /tmp/mock-upstream.log 2>&1 &
  MOCK_PID=$!
else
  if [ ! -f .dev.vars ]; then
    echo "real mode needs worker/.dev.vars with real PROXY_TOKEN and API keys"
    exit 1
  fi
fi

pnpm exec wrangler d1 migrations apply markdown-resume-history --local
pnpm exec wrangler d1 execute markdown-resume-history --local --command "DELETE FROM request_counts"

pnpm exec wrangler dev --port "$PORT" > /tmp/wrangler-dev.log 2>&1 &
WRANGLER_PID=$!

for _ in $(seq 1 60); do
  curl -s -o /dev/null "$BASE/" && break
  sleep 1
done

FAILURES=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; FAILURES=$((FAILURES + 1)); }
expect() {
  local name="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then pass "$name"; else fail "$name (expected [$expected], got [$actual])"; fi
}
jsonget() {
  node -e '
    let s = ""
    process.stdin.on("data", d => (s += d))
    process.stdin.on("end", () => {
      try {
        let v = JSON.parse(s)
        for (const k of process.argv[1].split(".")) v = v?.[k]
        process.stdout.write(String(v ?? "<missing>"))
      } catch {
        process.stdout.write("<parse-error>")
      }
    })
  ' "$1"
}
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }

expect "no token -> 401" 401 "$(code "$BASE/go/v1/models")"
expect "bad origin -> 403" 403 "$(code -H "$AUTH" -H "Origin: https://evil.example" "$BASE/go/v1/models")"
PREFLIGHT="$(curl -si -X OPTIONS -H "Origin: ${ORIGIN}" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: authorization,content-type,user-agent" "$BASE/go/v1/chat/completions")"
expect "preflight -> 204" 204 "$(printf '%s' "$PREFLIGHT" | head -n 1 | awk '{print $2}')"
case "$(printf '%s' "$PREFLIGHT" | tr '[:upper:]' '[:lower:]')" in
  *"access-control-allow-headers:"*"user-agent"*) pass "preflight allows user-agent" ;;
  *) fail "preflight allows user-agent" ;;
esac

GO_MODELS="$(curl -s -H "$AUTH" -H "Origin: ${ORIGIN}" "$BASE/go/v1/models")"
expect "go models" "mock-model" "$(printf '%s' "$GO_MODELS" | jsonget data.0.id)"
OR_MODELS="$(curl -s -H "$AUTH" "$BASE/openrouter/v1/models")"
expect "openrouter models" "mock-model" "$(printf '%s' "$OR_MODELS" | jsonget data.0.id)"

GO_REPLY="$(curl -s -H "$AUTH" -H "$JSON" -d "{\"model\":\"${MODEL_GO}\",\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}" "$BASE/go/v1/chat/completions")"
expect "go completion round-trip" "mock reply" "$(printf '%s' "$GO_REPLY" | jsonget choices.0.message.content)"

STREAM="$(curl -s -N -H "$AUTH" -H "$JSON" -d "{\"model\":\"${MODEL_OR}\",\"stream\":true,\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}" "$BASE/openrouter/v1/chat/completions")"
case "$STREAM" in
  *"[DONE]"*) pass "openrouter stream round-trip" ;;
  *) fail "openrouter stream round-trip (got: $(printf '%s' "$STREAM" | head -c 120))" ;;
esac

SESSION_ID="$(curl -s -H "$AUTH" -H "$JSON" -d '{"title":"test"}' "$BASE/sessions" | jsonget id)"
if [ "$SESSION_ID" != "<missing>" ] && [ "$SESSION_ID" != "<parse-error>" ]; then pass "session created"; else fail "session created (id: $SESSION_ID)"; fi
expect "session in list" "test" "$(curl -s -H "$AUTH" "$BASE/sessions" | jsonget 0.title)"

expect "empty session messages -> []" 0 "$(curl -s -H "$AUTH" "$BASE/sessions/$SESSION_ID/messages" | jsonget length)"
curl -s -o /dev/null -H "$AUTH" -H "$JSON" -d '{"messages":[{"role":"user","content":"u1"},{"role":"assistant","content":"a1"}]}' "$BASE/sessions/$SESSION_ID/messages"
MSGS="$(curl -s -H "$AUTH" "$BASE/sessions/$SESSION_ID/messages")"
expect "2 messages stored" 2 "$(printf '%s' "$MSGS" | jsonget length)"
expect "message order preserved" "user" "$(printf '%s' "$MSGS" | jsonget 0.role)"
expect "assistant content" "a1" "$(printf '%s' "$MSGS" | jsonget 1.content)"

expect "patch title" "renamed" "$(curl -s -X PATCH -H "$AUTH" -H "$JSON" -d '{"title":"renamed"}' "$BASE/sessions/$SESSION_ID" | jsonget title)"
expect "delete session" "true" "$(curl -s -X DELETE -H "$AUTH" "$BASE/sessions/$SESSION_ID" | jsonget ok)"
expect "messages after delete -> 404" 404 "$(code -H "$AUTH" "$BASE/sessions/$SESSION_ID/messages")"
expect "patch unknown session -> 404" 404 "$(code -X PATCH -H "$AUTH" -H "$JSON" -d '{"title":"x"}' "$BASE/sessions/nope")"
expect "bad message role -> 400" 400 "$(code -H "$AUTH" -H "$JSON" -d '{"messages":[{"role":"bogus","content":"x"}]}' "$BASE/sessions/nope/messages")"

if [ "$MODE" = "mock" ]; then
  for _ in 1 2 3 4; do
    curl -s -o /dev/null -H "$AUTH" -H "$JSON" -d '{"messages":[{"role":"user","content":"hi"}]}' "$BASE/go/v1/chat/completions"
  done
  expect "cap exceeded -> 429" 429 "$(code -H "$AUTH" -H "$JSON" -d '{"messages":[{"role":"user","content":"hi"}]}' "$BASE/go/v1/chat/completions")"
  expect "models not capped" 200 "$(code -H "$AUTH" "$BASE/go/v1/models")"
fi

echo
if [ "$FAILURES" -eq 0 ]; then
  echo "ALL CHECKS PASSED ($MODE mode)"
else
  echo "$FAILURES CHECK(S) FAILED ($MODE mode) — logs: /tmp/wrangler-dev.log /tmp/mock-upstream.log"
  exit 1
fi
