import { isReasoningUIPart, isTextUIPart, type UIMessage } from "ai";

const LEGACY_STORAGE_PREFIX = "sm.chat.v1:";
const SESSIONS_PREFIX = "sm.chat.sessions.v2:";
const ACTIVE_SESSION_PREFIX = "sm.chat.active.v2:";
const SESSION_DATA_PREFIX = "sm.chat.data.v2:";
const MAX_BYTES = 3_500_000;
const MIN_KEEP = 2;

export type ChatSessionMeta = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  preview?: string;
  messageCount?: number;
};

export function chatStorageKey(workspaceId: string): string {
  return `${LEGACY_STORAGE_PREFIX}${workspaceId}`;
}

export function chatSessionsKey(workspaceId: string): string {
  return `${SESSIONS_PREFIX}${workspaceId}`;
}

export function activeSessionKey(workspaceId: string): string {
  return `${ACTIVE_SESSION_PREFIX}${workspaceId}`;
}

export function sessionDataKey(workspaceId: string, sessionId: string): string {
  return `${SESSION_DATA_PREFIX}${workspaceId}:${sessionId}`;
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
    parts: (m.parts ?? []).map((p) => {
      if (isTextUIPart(p)) return p.state === "streaming" ? { ...p, state: "done" } : p;
      if (isReasoningUIPart(p)) return p.state === "streaming" ? { ...p, state: "done" } : p;
      if (p.type.startsWith("tool-") || p.type === "dynamic-tool") {
        const toolPart = p as Record<string, unknown>;
        if (toolPart.state === "call" || toolPart.state === "partial-call") {
          return {
            ...toolPart,
            state: "output-available",
            output: toolPart.output ?? { ok: false, error: "interrupted" },
          } as unknown as typeof p;
        }
      }
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
      (m): m is UIMessage =>
        !!m &&
        typeof m === "object" &&
        Array.isArray((m as UIMessage).parts) &&
        typeof (m as UIMessage).id === "string",
    );
  } catch {
    return [];
  }
}

export function deriveSessionTitle(messages: UIMessage[]): string {
  for (const m of messages) {
    if (m.role === "user") {
      if (Array.isArray(m.parts)) {
        for (const p of m.parts) {
          if (
            p &&
            typeof p === "object" &&
            "type" in p &&
            p.type === "text" &&
            typeof (p as { text?: unknown }).text === "string"
          ) {
            const txt = (p as { text: string }).text.trim();
            if (txt) {
              const firstLine = txt.split("\n")[0].trim();
              if (firstLine) return firstLine.slice(0, 42) + (firstLine.length > 42 ? "…" : "");
            }
          }
        }
      }
      if (typeof (m as unknown as { content?: unknown }).content === "string") {
        const txt = (m as unknown as { content: string }).content.trim();
        if (txt) {
          const firstLine = txt.split("\n")[0].trim();
          if (firstLine) return firstLine.slice(0, 42) + (firstLine.length > 42 ? "…" : "");
        }
      }
    }
  }
  return "New Chat";
}

export function formatSessionDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();

  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear();

  const timeStr = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  if (isToday) return `Today, ${timeStr}`;
  if (isYesterday) return `Yesterday, ${timeStr}`;

  const monthDay = date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
  return `${monthDay}, ${timeStr}`;
}

export function groupSessionsByDate(
  sessions: ChatSessionMeta[],
): { groupLabel: string; sessions: ChatSessionMeta[] }[] {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
  const startOfThisWeek = startOfToday - 6 * 24 * 60 * 60 * 1000;
  const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  const groups: { [key: string]: ChatSessionMeta[] } = {
    Today: [],
    Yesterday: [],
    "Previous 7 Days": [],
    "This Month": [],
    Older: [],
  };

  for (const s of sessions) {
    const t = s.updatedAt || s.createdAt;
    if (t >= startOfToday) {
      groups["Today"].push(s);
    } else if (t >= startOfYesterday) {
      groups["Yesterday"].push(s);
    } else if (t >= startOfThisWeek) {
      groups["Previous 7 Days"].push(s);
    } else if (t >= startOfThisMonth) {
      groups["This Month"].push(s);
    } else {
      groups["Older"].push(s);
    }
  }

  return Object.entries(groups)
    .filter(([_, items]) => items.length > 0)
    .map(([groupLabel, groupItems]) => ({ groupLabel, sessions: groupItems }));
}

/** Lists all chat sessions for a workspace, migrating legacy single-chat if present. */
export function listChatSessions(workspaceId: string | null): ChatSessionMeta[] {
  if (!isBrowser() || !workspaceId) return [];
  try {
    const raw = window.localStorage.getItem(chatSessionsKey(workspaceId));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
      }
    }

    // Check legacy storage
    const legacyRaw = window.localStorage.getItem(chatStorageKey(workspaceId));
    const legacyMsgs = parse(legacyRaw);
    if (legacyMsgs.length > 0) {
      const session: ChatSessionMeta = {
        id: "session-legacy",
        title: deriveSessionTitle(legacyMsgs),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messageCount: legacyMsgs.length,
      };
      window.localStorage.setItem(chatSessionsKey(workspaceId), JSON.stringify([session]));
      window.localStorage.setItem(sessionDataKey(workspaceId, "session-legacy"), JSON.stringify(legacyMsgs));
      window.localStorage.setItem(activeSessionKey(workspaceId), "session-legacy");
      return [session];
    }

    // Default initial session
    const initialSession: ChatSessionMeta = {
      id: `session-${Date.now()}`,
      title: "New Chat",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messageCount: 0,
    };
    window.localStorage.setItem(chatSessionsKey(workspaceId), JSON.stringify([initialSession]));
    window.localStorage.setItem(activeSessionKey(workspaceId), initialSession.id);
    return [initialSession];
  } catch {
    return [];
  }
}

/** Gets the active session ID for a workspace. */
export function getActiveSessionId(workspaceId: string | null): string {
  if (!isBrowser() || !workspaceId) return "default";
  try {
    const saved = window.localStorage.getItem(activeSessionKey(workspaceId));
    if (saved) return saved;
    const sessions = listChatSessions(workspaceId);
    if (sessions.length > 0) {
      window.localStorage.setItem(activeSessionKey(workspaceId), sessions[0].id);
      return sessions[0].id;
    }
  } catch {
    /* ignore */
  }
  return "default";
}

/** Sets the active session ID for a workspace. */
export function setActiveSessionId(workspaceId: string | null, sessionId: string): void {
  if (!isBrowser() || !workspaceId) return;
  try {
    window.localStorage.setItem(activeSessionKey(workspaceId), sessionId);
  } catch {
    /* ignore */
  }
}

/** Creates a brand new chat session and sets it as active. */
export function createChatSession(workspaceId: string | null, title = "New Chat"): ChatSessionMeta {
  const newSession: ChatSessionMeta = {
    id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messageCount: 0,
  };
  if (!isBrowser() || !workspaceId) return newSession;

  try {
    const sessions = listChatSessions(workspaceId);
    const updated = [newSession, ...sessions.filter((s) => s.id !== newSession.id)];
    window.localStorage.setItem(chatSessionsKey(workspaceId), JSON.stringify(updated));
    window.localStorage.setItem(activeSessionKey(workspaceId), newSession.id);
    // Explicitly initialize with empty array so it is clean and does not fall back to legacy storage
    window.localStorage.setItem(sessionDataKey(workspaceId, newSession.id), JSON.stringify([]));
  } catch {
    /* ignore */
  }
  return newSession;
}

/** Deletes a chat session and returns remaining sessions + new active session ID. */
export function deleteChatSession(
  workspaceId: string | null,
  sessionId: string,
): { remaining: ChatSessionMeta[]; activeId: string } {
  if (!isBrowser() || !workspaceId) return { remaining: [], activeId: "default" };

  try {
    window.localStorage.removeItem(sessionDataKey(workspaceId, sessionId));
    const sessions = listChatSessions(workspaceId).filter((s) => s.id !== sessionId);

    let activeId = getActiveSessionId(workspaceId);
    if (sessions.length === 0) {
      const fresh = createChatSession(workspaceId);
      return { remaining: [fresh], activeId: fresh.id };
    }

    if (activeId === sessionId) {
      activeId = sessions[0].id;
      setActiveSessionId(workspaceId, activeId);
    }

    window.localStorage.setItem(chatSessionsKey(workspaceId), JSON.stringify(sessions));
    return { remaining: sessions, activeId };
  } catch {
    return { remaining: [], activeId: "default" };
  }
}

/** Deletes all chat sessions for a workspace and creates a fresh initial session. */
export function deleteAllChatSessions(
  workspaceId: string | null,
): { remaining: ChatSessionMeta[]; activeId: string } {
  if (!isBrowser() || !workspaceId) return { remaining: [], activeId: "default" };
  try {
    const sessions = listChatSessions(workspaceId);
    for (const s of sessions) {
      window.localStorage.removeItem(sessionDataKey(workspaceId, s.id));
    }
    window.localStorage.removeItem(chatStorageKey(workspaceId));
    window.localStorage.removeItem(chatSessionsKey(workspaceId));
    window.localStorage.removeItem(activeSessionKey(workspaceId));

    const initial = createChatSession(workspaceId, "New Chat");
    return { remaining: [initial], activeId: initial.id };
  } catch {
    return { remaining: [], activeId: "default" };
  }
}

/** Renames a chat session. */
export function renameChatSession(
  workspaceId: string | null,
  sessionId: string,
  newTitle: string,
): void {
  if (!isBrowser() || !workspaceId || !newTitle.trim()) return;
  try {
    const sessions = listChatSessions(workspaceId).map((s) =>
      s.id === sessionId ? { ...s, title: newTitle.trim(), updatedAt: Date.now() } : s,
    );
    window.localStorage.setItem(chatSessionsKey(workspaceId), JSON.stringify(sessions));
  } catch {
    /* ignore */
  }
}

/** Loads chat messages for a specific session (or active session if omitted). */
export function loadChatMessages(
  workspaceId: string | null,
  sessionId?: string | null,
): UIMessage[] {
  if (!isBrowser() || !workspaceId) return [];
  try {
    const targetId = sessionId || getActiveSessionId(workspaceId);
    const sessionData = window.localStorage.getItem(sessionDataKey(workspaceId, targetId));
    if (sessionData !== null) {
      return settled(parse(sessionData));
    }
    // Fallback to legacy single-chat storage ONLY for legacy migrated session
    if (targetId === "session-legacy") {
      const legacyData = window.localStorage.getItem(chatStorageKey(workspaceId));
      if (legacyData) return settled(parse(legacyData));
    }
    return [];
  } catch {
    return [];
  }
}

/** Saves chat messages for a specific session (or active session if omitted). */
export function saveChatMessages(
  workspaceId: string | null,
  messages: UIMessage[],
  sessionId?: string | null,
): void {
  if (!isBrowser() || !workspaceId) return;
  const targetId = sessionId || getActiveSessionId(workspaceId);
  const ready = settled(messages);

  if (messages.length === 0) {
    try {
      window.localStorage.setItem(sessionDataKey(workspaceId, targetId), JSON.stringify([]));
    } catch {
      /* ignore */
    }
    return;
  }

  // Update session metadata (title, count, updatedAt)
  try {
    const sessions = listChatSessions(workspaceId);
    const existingIdx = sessions.findIndex((s) => s.id === targetId);
    const derivedTitle = deriveSessionTitle(ready);
    const lastUserOrAssistantText = ready
      .flatMap((m) => m.parts)
      .filter((p) => isTextUIPart(p) && p.text)
      .map((p) => (p as { text: string }).text)
      .at(-1);

    if (existingIdx >= 0) {
      const cur = sessions[existingIdx];
      const shouldUpdateTitle =
        (!cur.title || cur.title === "New Chat" || cur.title.startsWith("New Chat")) &&
        derivedTitle !== "New Chat";
      sessions[existingIdx] = {
        ...cur,
        title: shouldUpdateTitle ? derivedTitle : cur.title,
        updatedAt: Date.now(),
        messageCount: ready.length,
        preview: lastUserOrAssistantText ? lastUserOrAssistantText.slice(0, 60) : cur.preview,
      };
      window.localStorage.setItem(chatSessionsKey(workspaceId), JSON.stringify(sessions));
    } else {
      const newSessionMeta: ChatSessionMeta = {
        id: targetId,
        title: derivedTitle,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messageCount: ready.length,
        preview: lastUserOrAssistantText ? lastUserOrAssistantText.slice(0, 60) : undefined,
      };
      window.localStorage.setItem(chatSessionsKey(workspaceId), JSON.stringify([newSessionMeta, ...sessions]));
    }
  } catch {
    /* ignore */
  }

  // Save to target session key and mirror to legacy key
  const targetKey = sessionDataKey(workspaceId, targetId);
  const legacyKey = chatStorageKey(workspaceId);

  let payload = JSON.stringify(ready);
  if (byteSize(payload) <= MAX_BYTES) {
    try {
      window.localStorage.setItem(targetKey, payload);
      window.localStorage.setItem(legacyKey, payload);
      return;
    } catch {
      /* fall through to shrinking */
    }
  }

  for (let start = 0; start < Math.max(ready.length - MIN_KEEP, 0); start++) {
    const trimmed = ready.slice(start);
    payload = JSON.stringify(withoutDataUrls(trimmed));
    if (byteSize(payload) > MAX_BYTES) continue;
    try {
      window.localStorage.setItem(targetKey, payload);
      window.localStorage.setItem(legacyKey, payload);
      return;
    } catch {
      return;
    }
  }

  try {
    const minimal = JSON.stringify(withoutDataUrls(ready.slice(-MIN_KEEP)));
    window.localStorage.setItem(targetKey, minimal);
    window.localStorage.setItem(legacyKey, minimal);
  } catch {
    /* storage is full or blocked */
  }
}

/** Clears chat messages for a specific session (or active session if omitted). */
export function clearChatMessages(
  workspaceId: string | null,
  sessionId?: string | null,
): void {
  if (!isBrowser() || !workspaceId) return;
  const targetId = sessionId || getActiveSessionId(workspaceId);
  try {
    window.localStorage.removeItem(sessionDataKey(workspaceId, targetId));
    window.localStorage.removeItem(chatStorageKey(workspaceId));

    const sessions = listChatSessions(workspaceId).map((s) =>
      s.id === targetId ? { ...s, messageCount: 0, title: "New Chat", updatedAt: Date.now() } : s,
    );
    window.localStorage.setItem(chatSessionsKey(workspaceId), JSON.stringify(sessions));
  } catch {
    /* ignore */
  }
}
