<template>
  <div class="ai-chat pane-container" flex="~ col" bg-c text-c>
    <div class="hstack h-9 md:h-10 flex-none gap-2 px-3 border-b border-c text-sm">
      <span i-mdi:robot-outline flex-shrink-0 />
      <span font-bold>{{ $t("ai.title") }}</span>
      <span class="ai-mode">{{ $t(modeLabelKey) }}</span>
      <div class="flex-1" />
      <button
        class="round-btn flex-shrink-0"
        :aria-label="$t('ai.undo')"
        :title="$t('ai.undo')"
        :disabled="isRunning || !canUndo"
        @click="undo"
      >
        <span i-mdi:undo-variant md:text-lg />
      </button>
      <button
        class="round-btn flex-shrink-0"
        :aria-label="$t('toolbar.close')"
        :title="$t('toolbar.close')"
        @click="$emit('close')"
      >
        <span i-tabler:x md:text-lg />
      </button>
    </div>

    <div
      ref="listRef"
      class="ai-messages min-h-0 flex-1 overflow-y-auto px-3 py-2 space-y-2"
    >
      <p v-if="!items.length" class="ai-empty">{{ $t("ai.empty") }}</p>

      <div v-for="item in items" :key="item.id">
        <p v-if="item.role === 'user'" class="ai-bubble ai-bubble--user">
          {{ item.text }}
        </p>

        <div v-else-if="item.role === 'notice'" class="ai-notice">
          <span
            :class="
              item.code === 'error'
                ? 'i-mdi:alert-circle-outline'
                : 'i-mdi:information-outline'
            "
            flex-shrink-0
          />
          <span>{{ item.text }}</span>
        </div>

        <div v-else class="ai-bubble ai-bubble--assistant">
          <p class="whitespace-pre-wrap">{{ item.text || (isRunning ? "…" : "") }}</p>
          <div v-if="item.suggestion" class="ai-suggestion">
            <pre class="ai-snippet">{{ item.suggestion }}</pre>
            <button class="ai-apply" :disabled="isRunning" @click="applySnippet(item)">
              {{ $t("ai.apply") }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="flex-none border-t border-c p-2">
      <div class="hstack items-end gap-2">
        <textarea
          v-model="input"
          rows="2"
          class="ai-input"
          :placeholder="$t('ai.placeholder')"
          :disabled="isRunning"
          @keydown.enter.exact.prevent="onEnter"
        />
        <button
          v-if="!isRunning"
          class="round-btn flex-shrink-0"
          :aria-label="$t('ai.send')"
          :title="$t('ai.send')"
          @click="send"
        >
          <span i-mdi:send md:text-lg />
        </button>
        <button
          v-else
          class="round-btn flex-shrink-0"
          :aria-label="$t('ai.stop')"
          :title="$t('ai.stop')"
          @click="stop"
        >
          <span i-mdi:stop-circle-outline md:text-lg />
        </button>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import type { ModelMessage } from "ai";
import {
  aiHistoryEnabled,
  applySuggestion,
  ensureAiSession,
  extractSuggestion,
  loadAiHistory,
  popUndoSnapshot,
  pushUndoSnapshot,
  runAgentTurn,
  saveAiTurn,
  type AgentEvent,
  type AgentNoticeCode
} from "~/utils/ai";
import {
  getAiAgentMode,
  getAiModel,
  getAiProvider,
  getAiToken,
  type AiAgentMode
} from "~/utils/aiSettings";

interface ChatItem {
  id: number;
  role: "user" | "assistant" | "notice";
  text: string;
  code?: AgentNoticeCode | "write";
  suggestion?: string;
}

defineEmits<{ (e: "close"): void }>();

const { data } = useDataStore();
const { t } = useI18n();

const listRef = ref<HTMLElement>();
const items = ref<ChatItem[]>([]);
const input = ref("");
const isRunning = ref(false);
const canUndo = ref(true);

let nextId = 1;
let history: ModelMessage[] = [];
const mode = ref<AiAgentMode>("suggest");
let abort: AbortController | undefined;

const modeLabelKey = computed(() =>
  mode.value === "auto-edit" ? "settings.ai_mode_auto_edit" : "settings.ai_mode_suggest"
);

const push = (item: Omit<ChatItem, "id">): ChatItem => {
  const full = { ...item, id: nextId++ };
  items.value.push(full);
  return full;
};

const scrollToBottom = () =>
  nextTick(() => {
    const el = listRef.value;
    if (el) el.scrollTop = el.scrollHeight;
  });

const writeResume = async (markdown: string): Promise<boolean> => {
  const ok = await pushUndoSnapshot({
    resumeId: data.curResumeId,
    markdown: data.mdContent,
    ts: Date.now()
  });
  if (!ok) return false;
  setResumeMd(markdown);
  return true;
};

const applySnippet = async (item: ChatItem) => {
  if (!item.suggestion || isRunning.value) return;
  if (await writeResume(applySuggestion(data.mdContent, item.suggestion))) {
    item.suggestion = undefined;
    canUndo.value = true;
  }
};

const undo = async () => {
  if (isRunning.value) return;
  for (;;) {
    const snap = await popUndoSnapshot();
    if (!snap) {
      canUndo.value = false;
      push({ role: "notice", text: t("ai.undo_empty"), code: "error" });
      scrollToBottom();
      return;
    }
    if (snap.resumeId === null || snap.resumeId === data.curResumeId) {
      setResumeMd(snap.markdown);
      scrollToBottom();
      return;
    }
  }
};

const stop = () => abort?.abort();

const onEnter = (e: KeyboardEvent) => {
  if (!e.isComposing) send();
};

const send = async () => {
  const text = input.value.trim();
  const token = getAiToken();
  if (!text || isRunning.value || !token) return;

  mode.value = getAiAgentMode();
  if (!getAiModel()) {
    push({ role: "notice", text: t("ai.no_model"), code: "error" });
    scrollToBottom();
    return;
  }

  input.value = "";
  push({ role: "user", text });
  const live = push({ role: "assistant", text: "" });
  isRunning.value = true;
  abort = new AbortController();
  scrollToBottom();

  const onEvent = (e: AgentEvent) => {
    if (e.type === "text-delta") {
      live.text += e.text;
      scrollToBottom();
    } else if (e.type === "tool-write") {
      canUndo.value = true;
      push({ role: "notice", code: "write", text: t("ai.notice_write") });
      scrollToBottom();
    } else if (e.code === "error") {
      push({
        role: "notice",
        code: "error",
        text: t("ai.notice_error", { message: e.detail ?? "" })
      });
      scrollToBottom();
    } else if (e.code === "degraded") {
      push({ role: "notice", code: "degraded", text: t("ai.notice_degraded") });
      scrollToBottom();
    } else {
      push({
        role: "notice",
        code: "loop-abort",
        text: t("ai.notice_loop_abort", { max: 8 })
      });
      scrollToBottom();
    }
  };

  let result: Awaited<ReturnType<typeof runAgentTurn>>;
  try {
    result = await runAgentTurn({
      provider: getAiProvider(),
      model: getAiModel(),
      token,
      mode: mode.value,
      messages: history,
      userText: text,
      getResume: () => data.mdContent,
      writeResume,
      signal: abort.signal,
      onEvent
    });
  } catch (e) {
    push({
      role: "notice",
      code: "error",
      text: t("ai.notice_error", { message: e instanceof Error ? e.message : String(e) })
    });
    scrollToBottom();
    return;
  } finally {
    isRunning.value = false;
    abort = undefined;
  }

  live.text = result.assistantText || live.text;
  if (!result.wroteResume && (mode.value === "suggest" || result.degraded)) {
    const snippet = extractSuggestion(result.assistantText);
    if (snippet) live.suggestion = snippet;
  }
  history = result.messages;

  if (aiHistoryEnabled()) {
    try {
      const sessionId = await ensureAiSession(token);
      await saveAiTurn(token, sessionId, text, result.assistantText);
    } catch {}
  }

  scrollToBottom();
};

onMounted(async () => {
  mode.value = getAiAgentMode();
  const token = getAiToken();
  if (token && aiHistoryEnabled()) {
    try {
      const restored = await loadAiHistory(token);
      for (const m of restored) push({ role: m.role, text: m.content });
      history = restored.map((m) => ({ role: m.role, content: m.content }));
    } catch {}
  }
});
</script>

<style scoped>
.ai-chat {
  @apply w-full h-full text-sm;
}

.ai-mode {
  @apply text-light-c text-xs border border-c rounded-full px-2 py-0.5;
}

.ai-empty {
  @apply text-light-c text-center mt-6;
}

.ai-bubble {
  @apply rounded-lg px-3 py-2 border border-c;
}

.ai-bubble--user {
  @apply bg-blue-500/10 border-blue-500/30;
}

.ai-bubble--assistant {
  @apply bg-c;
}

.ai-notice {
  @apply flex gap-1.5 text-light-c italic;
}

.ai-suggestion {
  @apply mt-2 border-t border-c pt-2;
}

.ai-snippet {
  @apply whitespace-pre-wrap text-xs bg-gray-100 dark:bg-[#1e1e1e] rounded p-2 max-h-48 overflow-y-auto;
}

.ai-apply {
  @apply mt-2 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded px-3 py-1 disabled:opacity-50;
}

.ai-input {
  @apply flex-1 resize-none bg-c border border-c rounded px-2 py-1.5 outline-none focus:border-blue-500 disabled:opacity-60;
}
</style>
