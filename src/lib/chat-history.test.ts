import { describe, expect, it, beforeEach, afterAll } from "vitest";
import {
  clearChatMessages,
  loadChatMessages,
  saveChatMessages,
  createChatSession,
  listChatSessions,
  deleteChatSession,
  renameChatSession,
} from "./chat-history";
import type { UIMessage } from "ai";

const WS = "ws-1";

function installLocalStorage() {
  const store = new Map<string, string>();
  const stub = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(globalThis, "window", {
    value: { localStorage: stub },
    configurable: true,
    writable: true,
  });
  return stub;
}

const memory = installLocalStorage();
const localStorage = memory as unknown as Storage;

afterAll(() => {
  Reflect.deleteProperty(globalThis, "window");
});

function msg(id: string, text: string): UIMessage {
  return {
    id,
    role: "assistant",
    parts: [{ type: "text", text, state: "done" }],
  } as UIMessage;
}

describe("chat history", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("round-trips messages per workspace", () => {
    saveChatMessages(WS, [msg("a", "first"), msg("b", "second")]);
    const loaded = loadChatMessages(WS);
    expect(loaded.map((m) => m.id)).toEqual(["a", "b"]);
    expect(loaded[1].parts[0]).toMatchObject({ type: "text", text: "second" });
  });

  it("keeps workspaces isolated from each other", () => {
    saveChatMessages("ws-1", [msg("a", "one")]);
    saveChatMessages("ws-2", [msg("b", "two")]);
    expect(loadChatMessages("ws-1").map((m) => m.id)).toEqual(["a"]);
    expect(loadChatMessages("ws-2").map((m) => m.id)).toEqual(["b"]);
  });

  it("normalises a streaming text part to done so restore is not stuck", () => {
    saveChatMessages(WS, [
      {
        id: "a",
        role: "assistant",
        parts: [{ type: "text", text: "half", state: "streaming" }],
      } as UIMessage,
    ]);
    const loaded = loadChatMessages(WS);
    expect(loaded[0].parts[0]).toMatchObject({ state: "done" });
  });

  it("clears on empty save so a fresh chat has no stale history", () => {
    saveChatMessages(WS, [msg("a", "one")]);
    saveChatMessages(WS, []);
    expect(loadChatMessages(WS)).toEqual([]);
  });

  it("clearChatMessages removes only the target workspace", () => {
    saveChatMessages("ws-1", [msg("a", "one")]);
    saveChatMessages("ws-2", [msg("b", "two")]);
    clearChatMessages("ws-1");
    expect(loadChatMessages("ws-1")).toEqual([]);
    expect(loadChatMessages("ws-2")).toHaveLength(1);
  });

  it("returns empty for a null workspace instead of throwing", () => {
    expect(loadChatMessages(null)).toEqual([]);
    expect(() => saveChatMessages(null, [msg("a", "x")])).not.toThrow();
    expect(() => clearChatMessages(null)).not.toThrow();
  });

  it("survives corrupt stored JSON", () => {
    localStorage.setItem("sm.chat.v1:ws-1", "{not json");
    expect(loadChatMessages(WS)).toEqual([]);
  });

  it("drops malformed entries but keeps valid ones", () => {
    localStorage.setItem("sm.chat.v1:ws-1", JSON.stringify([{ nope: true }, msg("a", "ok")]));
    const loaded = loadChatMessages(WS);
    expect(loaded.map((m) => m.id)).toEqual(["a"]);
  });

  it("stays under the storage budget by dropping the oldest turns", () => {
    const big = "x".repeat(200_000);
    const many = Array.from({ length: 40 }, (_, i) => msg(`m${i}`, `${i}:${big}`));
    saveChatMessages(WS, many);
    const loaded = loadChatMessages(WS);
    const stored = localStorage.getItem("sm.chat.v1:ws-1") ?? "";
    expect(stored.length).toBeLessThanOrEqual(3_500_000);
    expect(loaded.length).toBeGreaterThan(0);
    expect(loaded.length).toBeLessThan(many.length);
    expect(loaded.at(-1)?.id).toBe("m39");
  });

  it("strips data urls when a turn is too large to keep whole", () => {
    const dataUrl = `data:image/png;base64,${"A".repeat(4_000_000)}`;
    saveChatMessages(WS, [
      {
        id: "a",
        role: "user",
        parts: [{ type: "file", mediaType: "image/png", filename: "x.png", url: dataUrl }],
      } as unknown as UIMessage,
      msg("b", "after"),
    ]);
    const stored = localStorage.getItem("sm.chat.v1:ws-1") ?? "";
    expect(stored).not.toContain("base64,AAAA");
    expect(stored.length).toBeLessThanOrEqual(3_500_000);
    expect(loadChatMessages(WS).some((m) => m.id === "b")).toBe(true);
  });

  it("keeps a payload that fits without touching data urls", () => {
    const dataUrl = `data:image/png;base64,${"A".repeat(1000)}`;
    saveChatMessages(WS, [
      {
        id: "a",
        role: "user",
        parts: [{ type: "file", mediaType: "image/png", filename: "x.png", url: dataUrl }],
      } as unknown as UIMessage,
    ]);
    expect(localStorage.getItem("sm.chat.v1:ws-1") ?? "").toContain("base64,AAA");
  });

  it("supports multiple chat sessions with dates and switching", async () => {
    const {
      listChatSessions,
      createChatSession,
      deleteChatSession,
      renameChatSession,
      formatSessionDate,
      groupSessionsByDate,
    } = await import("./chat-history");

    // Initially lists sessions
    const initial = listChatSessions(WS);
    expect(initial.length).toBeGreaterThanOrEqual(1);

    // Create a new session
    const s2 = createChatSession(WS, "Marketing Strategy");
    expect(s2.title).toBe("Marketing Strategy");

    // Save messages to specific session
    saveChatMessages(WS, [msg("msg-s2", "Strategy outline")], s2.id);
    const loadedS2 = loadChatMessages(WS, s2.id);
    expect(loadedS2).toHaveLength(1);

    // Rename session
    renameChatSession(WS, s2.id, "Growth Marketing 2026");
    const sessions = listChatSessions(WS);
    const found = sessions.find((s) => s.id === s2.id);
    expect(found?.title).toBe("Growth Marketing 2026");

    // Date formatting
    const formattedDate = formatSessionDate(Date.now());
    expect(formattedDate).toContain("Today");

    // Date grouping
    const grouped = groupSessionsByDate(sessions);
    expect(grouped.length).toBeGreaterThan(0);
    expect(grouped[0].groupLabel).toBe("Today");

    // Delete session
    const { remaining } = deleteChatSession(WS, s2.id);
    expect(remaining.some((s) => s.id === s2.id)).toBe(false);
  });

  it("preserves separate message histories for distinct sessions without cross-contamination", () => {
    const s1 = createChatSession(WS, "Chat 1");
    const s2 = createChatSession(WS, "Chat 2");

    saveChatMessages(WS, [msg("m1", "First conversation")], s1.id);
    saveChatMessages(WS, [msg("m2", "Second conversation"), msg("m3", "Follow-up")], s2.id);

    const load1 = loadChatMessages(WS, s1.id);
    const load2 = loadChatMessages(WS, s2.id);

    expect(load1).toHaveLength(1);
    expect(load1[0].id).toBe("m1");

    expect(load2).toHaveLength(2);
    expect(load2[0].id).toBe("m2");
    expect(load2[1].id).toBe("m3");

    // Automatic title derivation updates "New Chat" when user messages are added
    const s3 = createChatSession(WS, "New Chat");
    saveChatMessages(
      WS,
      [
        {
          id: "m4",
          role: "user",
          parts: [{ type: "text", text: "What are the latest AI news?" }],
        } as UIMessage,
      ],
      s3.id,
    );
    const sessions = listChatSessions(WS);
    const updatedS3 = sessions.find((s) => s.id === s3.id);
    expect(updatedS3?.title).toBe("What are the latest AI news?");
    expect(updatedS3?.messageCount).toBe(1);
  });
});

