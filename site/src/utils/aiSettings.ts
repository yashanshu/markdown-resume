export type AiProvider = "go" | "openrouter";
export type AiAgentMode = "auto-edit" | "suggest";
export type AiHistory = "server" | "off";

export const AI_API_BASE_URL = "https://api-resume.hasufel.shop";

export const AI_TOKEN_STORAGE_KEY = "ai-proxy-token";
export const AI_PROVIDER_STORAGE_KEY = "ai-provider";
export const AI_MODEL_STORAGE_KEY = "ai-model";
export const AI_AGENT_MODE_STORAGE_KEY = "ai-agent-mode";
export const AI_HISTORY_STORAGE_KEY = "ai-history";

export const AI_STORAGE_KEYS = [
  AI_TOKEN_STORAGE_KEY,
  AI_PROVIDER_STORAGE_KEY,
  AI_MODEL_STORAGE_KEY,
  AI_AGENT_MODE_STORAGE_KEY,
  AI_HISTORY_STORAGE_KEY
];

const isProvider = (v: string | null): v is AiProvider =>
  v === "go" || v === "openrouter";
const isAgentMode = (v: string | null): v is AiAgentMode =>
  v === "auto-edit" || v === "suggest";
const isHistory = (v: string | null): v is AiHistory => v === "server" || v === "off";

export const getAiToken = (): string => localStorage.getItem(AI_TOKEN_STORAGE_KEY) || "";

export const setAiToken = (token: string): void => {
  localStorage.setItem(AI_TOKEN_STORAGE_KEY, token);
};

export const getAiProvider = (): AiProvider => {
  const v = localStorage.getItem(AI_PROVIDER_STORAGE_KEY);
  return isProvider(v) ? v : "go";
};

export const setAiProvider = (provider: AiProvider): void => {
  localStorage.setItem(AI_PROVIDER_STORAGE_KEY, provider);
};

export const getAiModel = (): string => localStorage.getItem(AI_MODEL_STORAGE_KEY) || "";

export const setAiModel = (model: string): void => {
  localStorage.setItem(AI_MODEL_STORAGE_KEY, model);
};

export const getAiAgentMode = (): AiAgentMode => {
  const v = localStorage.getItem(AI_AGENT_MODE_STORAGE_KEY);
  return isAgentMode(v) ? v : "suggest";
};

export const setAiAgentMode = (mode: AiAgentMode): void => {
  localStorage.setItem(AI_AGENT_MODE_STORAGE_KEY, mode);
};

export const getAiHistory = (): AiHistory => {
  const v = localStorage.getItem(AI_HISTORY_STORAGE_KEY);
  return isHistory(v) ? v : "off";
};

export const setAiHistory = (history: AiHistory): void => {
  localStorage.setItem(AI_HISTORY_STORAGE_KEY, history);
};

export const fetchAiModels = async (
  provider: AiProvider,
  token: string
): Promise<string[]> => {
  const res = await fetch(`${AI_API_BASE_URL}/${provider}/v1/models`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(`models request failed: ${res.status}`);
  const body = (await res.json()) as { data?: Array<{ id?: string }> };
  return (body.data ?? []).map((m) => m.id).filter((id): id is string => Boolean(id));
};
