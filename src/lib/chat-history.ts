import { isReasoningUIPart, isTextUIPart, type UIMessage } from "ai";

const STORAGE_PREFIX = "sm.chat.v1:";
const MAX_BYTES = 3_500_000;
const MIN_KEEP = 2;

export function chatStorageKey(workspaceId: string): string {
  return `${STORAGE_PREFIX}${workspaceId}`;
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function byteSize(value: string): number {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(value).length;
  return value.length * 2;
}

function settled(messages: UIMessage[]): UIMessage[] {
  return messages.map((m) => ({
    ...m,
    parts: m.parts.map((p) => {
      if (isTextUIPart(p)) return p.state === "streaming" ? { ...p, state: "done" } : p;
      if (isReasoningUIPart(p)) return p.state === "streaming" ? { ...p, state: "done" } : p;
      return p;
    }),
  }));
}

function withoutDataUrls(messages: UIMessage[]): UIMessage[] {
  return messages.map((m) => ({
    ...m,
    parts: m.parts.map((p) =>
      p.type === "file" && typeof p.url === "string" && p.url.startsWith("data:")
        ? { ...p, url: "" }
        : p,
    ),
  }));
}

function parse(raw: string | null): UIMessage[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m): m is UIMessage => !!m && typeof m === "object" && Array.isArray((m as UIMessage).parts),
    );
  } catch {
    return [];
  }
}

export function loadChatMessages(workspaceId: string | null): UIMessage[] {
  if (!isBrowser() || !workspaceId) return [];
  try {
    return settled(parse(window.localStorage.getItem(chatStorageKey(workspaceId))));
  } catch {
    return [];
  }
}

export function saveChatMessages(workspaceId: string | null, messages: UIMessage[]): void {
  if (!isBrowser() || !workspaceId) return;
  if (messages.length === 0) {
    clearChatMessages(workspaceId);
    return;
  }
  const key = chatStorageKey(workspaceId);
  const ready = settled(messages);

  let payload = JSON.stringify(ready);
  if (byteSize(payload) <= MAX_BYTES) {
    try {
      window.localStorage.setItem(key, payload);
      return;
    } catch {
      /* fall through to the shrinking strategies */
    }
  }

  for (let start = 0; start < Math.max(ready.length - MIN_KEEP, 0); start++) {
    const trimmed = ready.slice(start);
    payload = JSON.stringify(withoutDataUrls(trimmed));
    if (byteSize(payload) > MAX_BYTES) continue;
    try {
      window.localStorage.setItem(key, payload);
      return;
    } catch {
      return;
    }
  }

  try {
    window.localStorage.setItem(key, JSON.stringify(withoutDataUrls(ready.slice(-MIN_KEEP))));
  } catch {
    /* storage is full or blocked: history is best-effort, never fatal */
  }
}

export function clearChatMessages(workspaceId: string | null): void {
  if (!isBrowser() || !workspaceId) return;
  try {
    window.localStorage.removeItem(chatStorageKey(workspaceId));
  } catch {
    /* ignore */
  }
}
