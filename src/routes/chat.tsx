import { createFileRoute, Link } from "@tanstack/react-router";
import { Logo } from "@/components/logo";
import { useEffect, useMemo, useRef, useState } from "react";
import { brandContextMeta, brandStore } from "@/lib/brand-store";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Send,
  Loader2,
  CalendarCheck2,
  CalendarClock,
  CalendarX2,
  ListChecks,
  Share2,
  ImageIcon,
  Star,
  Paperclip,
  X,
  FileText,
  Search,
  ExternalLink,
  Copy,
  Check,
  Square,
  History,
  Plus,
  Trash2,
  Pencil,
  MessageSquare,
  Clock,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import { useWorkspace } from "@/lib/workspace";
import {
  clearChatMessages,
  groupSessionsByDate,
  formatSessionDate,
  type ChatSessionMeta,
} from "@/lib/chat-history";
import { logActivityFn } from "@/lib/activity-log";
import { safeHttpUrl } from "@/lib/safe-url";
import { useChatSession, type GenImageArgs, type ScheduleArgs } from "@/lib/chat-session";

export const Route = createFileRoute("/chat")({
  head: () => ({
    meta: [
      { title: "Chat · Pippzo" },
      { name: "description", content: "Talk to your social agent." },
    ],
  }),
  component: ChatPage,
});

type LibraryItem = { id: string; name: string; approved: boolean; analysis?: string };

function LibraryPicker({
  done,
  items,
  count,
  resolveSrc,
  onInsert,
}: {
  done: boolean;
  items: LibraryItem[];
  count: number;
  resolveSrc: (id: string) => string | undefined;
  onInsert: (ids: string[]) => void;
}) {
  const PAGE = 8;
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const pages = Math.max(1, Math.ceil(items.length / PAGE));
  const safePage = Math.min(page, pages - 1);
  const slice = items.slice(safePage * PAGE, safePage * PAGE + PAGE);
  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <div className="rounded-xl border border-border bg-muted/40 p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <ImageIcon className="h-4 w-4" />
        {done ? `Visual library · ${count} image${count === 1 ? "" : "s"}` : "Loading library…"}
      </div>
      {done && items.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Nothing saved yet. Upload some in{" "}
          <Link to="/library" className="underline">
            Library
          </Link>
          .
        </p>
      )}
      {items.length > 0 && (
        <>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {slice.map((it) => {
              const src = resolveSrc(it.id);
              const isSel = selected.includes(it.id);
              return (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => toggle(it.id)}
                  className={`relative rounded-md overflow-hidden border bg-background text-left transition ${isSel ? "border-foreground ring-2 ring-foreground" : "border-border hover:border-foreground/50"}`}
                >
                  {src ? (
                    <img src={src} alt={it.name} className="w-full aspect-square object-cover" />
                  ) : (
                    <div className="w-full aspect-square grid place-items-center text-[10px] text-muted-foreground">
                      no preview
                    </div>
                  )}
                  {it.approved && (
                    <div className="absolute top-1 left-1 rounded-full bg-accent text-accent-foreground p-0.5">
                      <Star className="h-2.5 w-2.5" />
                    </div>
                  )}
                  {isSel && (
                    <div className="absolute top-1 right-1 rounded-full bg-foreground text-background text-[10px] font-semibold h-4 min-w-4 px-1 grid place-items-center">
                      {selected.indexOf(it.id) + 1}
                    </div>
                  )}
                  <div className="absolute bottom-0 left-0 right-0 bg-background/85 backdrop-blur-sm px-1.5 py-0.5 text-[9px] font-mono text-muted-foreground truncate">
                    {it.id.slice(0, 8)}
                  </div>
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={safePage === 0}
                onClick={() => setPage(safePage - 1)}
              >
                Prev
              </Button>
              <span className="text-[11px] text-muted-foreground px-1">
                Page {safePage + 1} / {pages}
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={safePage >= pages - 1}
                onClick={() => setPage(safePage + 1)}
              >
                Next
              </Button>
            </div>
            <div className="flex items-center gap-2">
              {selected.length > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => setSelected([])}
                >
                  Clear
                </Button>
              )}
              <Button
                size="sm"
                className="h-7 text-xs"
                disabled={selected.length === 0}
                onClick={() => {
                  onInsert(selected);
                  setSelected([]);
                }}
              >
                Use {selected.length || ""} selected
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ChatPage() {
  const { activeWorkspaceId } = useWorkspace();
  // Session state comes from the root-level provider so an active agent turn
  // survives navigating away from this page and back.
  const {
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    imageFrames,
    videoJobs,
    imageStashRef,
    videoStashRef,
    buffer,
    activeSessionId,
    sessions,
    createSession,
    switchSession,
    deleteSession,
    deleteAllSessions,
    renameSession,
  } = useChatSession();
  const [meta, setMeta] = useState({
    hasProfile: false,
    hasGuideline: false,
    approvedImages: 0,
    chars: 0,
  });

  const [showHistory, setShowHistory] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");

  const groupedSessions = useMemo(() => groupSessionsByDate(sessions), [sessions]);

  const handleNewChat = () => {
    createSession();
    setInput("");
    setAttachments([]);
    toast.success("Started new chat");
    setTimeout(() => taRef.current?.focus(), 0);
  };

  const handleStartRename = (s: { id: string; title: string }) => {
    setEditingSessionId(s.id);
    setEditTitle(s.title);
  };

  const handleSaveRename = (id: string) => {
    if (editTitle.trim()) {
      renameSession(id, editTitle.trim());
      toast.success("Chat renamed");
    }
    setEditingSessionId(null);
  };

  const handleDeleteChat = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteSession(id);
    toast.success("Chat deleted");
  };

  const handleDeleteCurrentChat = () => {
    deleteSession(activeSessionId);
    setInput("");
    setAttachments([]);
    toast.success("Chat deleted");
  };

  const handleClearAllHistory = () => {
    if (window.confirm("Are you sure you want to delete all chat history? This cannot be undone.")) {
      deleteAllSessions();
      setInput("");
      setAttachments([]);
      toast.success("All chat history deleted");
    }
  };

  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Whether the transcript should keep pinning to the newest message. True
  // while the reader is at (or near) the bottom; a manual scroll away from
  // the bottom disengages it so a streaming reply doesn't yank them back
  // down. Scrolling back to the bottom re-engages it. A ref (not state)
  // because the scroll handler must not trigger a re-render on every event.
  const pinnedToBottomRef = useRef(true);
  const NEAR_BOTTOM_PX = 80;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      pinnedToBottomRef.current = distanceFromBottom <= NEAR_BOTTOM_PX;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !pinnedToBottomRef.current) return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: el.scrollHeight, behavior: reduceMotion ? "auto" : "smooth" });
  }, [messages, status]);
  useEffect(() => {
    taRef.current?.focus();
  }, []);

  const MAX_IMAGE = 10 * 1024 * 1024;
  const MAX_PDF = 20 * 1024 * 1024;
  const acceptFiles = (files: FileList | File[] | null) => {
    if (!files) return;
    const next: File[] = [];
    for (const f of Array.from(files)) {
      const isImage = f.type.startsWith("image/");
      const isPdf = f.type === "application/pdf";
      if (!isImage && !isPdf) {
        toast.error(`${f.name}: unsupported type`);
        continue;
      }
      if (isImage && f.size > MAX_IMAGE) {
        toast.error(`${f.name}: image over 10 MB`);
        continue;
      }
      if (isPdf && f.size > MAX_PDF) {
        toast.error(`${f.name}: PDF over 20 MB`);
        continue;
      }
      next.push(f);
    }
    if (next.length) setAttachments((cur) => [...cur, ...next].slice(0, 6));
  };

  const send = async () => {
    const v = input.trim();
    if ((!v && attachments.length === 0) || status === "submitted" || status === "streaming")
      return;
    const fileParts = await Promise.all(
      attachments.map(
        (f) =>
          new Promise<{ type: "file"; mediaType: string; url: string; filename: string }>(
            (resolve, reject) => {
              const r = new FileReader();
              r.onload = () =>
                resolve({
                  type: "file",
                  mediaType: f.type || "application/octet-stream",
                  url: r.result as string,
                  filename: f.name,
                });
              r.onerror = () => reject(r.error ?? new Error("read_failed"));
              r.readAsDataURL(f);
            },
          ),
      ),
    );
    // The user just took a deliberate action, so pin the transcript back to
    // the bottom even if they had scrolled up to read earlier messages.
    pinnedToBottomRef.current = true;
    sendMessage({
      text: v || "(see attachments)",
      files: fileParts.length ? fileParts : undefined,
    });
    if (activeWorkspaceId) {
      logActivityFn({
        workspaceId: activeWorkspaceId,
        actorType: "user",
        action: "chat.message.sent",
        summary: `Chat: "${v.slice(0, 120)}"${attachments.length ? ` · ${attachments.length} attachment${attachments.length === 1 ? "" : "s"}` : ""}`,
      });
    }
    setInput("");
    setAttachments([]);
    setTimeout(() => taRef.current?.focus(), 0);
  };

  const copyToClipboard = (id: string, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500);
  };

  return (
    <div className="flex h-[calc(100vh-3rem)] overflow-hidden">
      {/* Collapsible Chat History Drawer / Sidebar */}
      {showHistory && (
        <aside className="w-80 border-r border-border bg-card/60 backdrop-blur-sm flex flex-col shrink-0 h-full z-20 transition-all">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-primary" />
              <span className="font-semibold text-sm">Chat History</span>
              <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                {sessions.length}
              </span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground"
              onClick={() => setShowHistory(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="p-3 border-b border-border/60">
            <Button
              onClick={handleNewChat}
              className="w-full gap-2 text-xs h-9 justify-center font-medium shadow-sm"
            >
              <Plus className="h-4 w-4" /> Start New Chat
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-4">
            {groupedSessions.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-8">
                No past chats yet. Start a new conversation!
              </p>
            ) : (
              groupedSessions.map((group) => (
                <div key={group.groupLabel} className="space-y-1.5">
                  <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    <Clock className="h-3 w-3" />
                    <span>{group.groupLabel}</span>
                  </div>
                  <div className="space-y-1">
                    {group.sessions.map((s) => {
                      const isActive = s.id === activeSessionId;
                      const isEditing = s.id === editingSessionId;

                      return (
                        <div
                          key={s.id}
                          onClick={() => {
                            if (!isEditing) switchSession(s.id);
                          }}
                          className={`group relative rounded-lg px-2.5 py-2 text-xs cursor-pointer border transition-all ${
                            isActive
                              ? "bg-accent/40 border-foreground/40 shadow-sm font-medium"
                              : "border-transparent hover:bg-muted/50 hover:border-border/60 text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {isEditing ? (
                            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                              <input
                                autoFocus
                                value={editTitle}
                                onChange={(e) => setEditTitle(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") handleSaveRename(s.id);
                                  if (e.key === "Escape") setEditingSessionId(null);
                                }}
                                className="w-full text-xs bg-background border border-primary px-1.5 py-0.5 rounded font-medium text-foreground focus:outline-none"
                              />
                              <button
                                type="button"
                                onClick={() => handleSaveRename(s.id)}
                                className="p-1 hover:text-emerald-500 text-muted-foreground"
                              >
                                <Check className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingSessionId(null)}
                                className="p-1 hover:text-destructive text-muted-foreground"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-start justify-between gap-1.5">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <MessageSquare className="h-3 w-3 shrink-0 opacity-70" />
                                  <p className="truncate font-medium text-foreground leading-snug">
                                    {s.title}
                                  </p>
                                </div>
                                <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                                  <span>{formatSessionDate(s.updatedAt || s.createdAt)}</span>
                                  {typeof s.messageCount === "number" && s.messageCount > 0 && (
                                    <span>· {s.messageCount} msg{s.messageCount === 1 ? "" : "s"}</span>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-center gap-0.5 opacity-70 group-hover:opacity-100 hover:opacity-100 transition-opacity shrink-0">
                                <button
                                  type="button"
                                  title="Rename chat"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleStartRename(s);
                                  }}
                                  className="p-1 hover:text-foreground text-muted-foreground hover:bg-muted rounded"
                                >
                                  <Pencil className="h-3 w-3" />
                                </button>
                                <button
                                  type="button"
                                  title="Delete chat"
                                  onClick={(e) => handleDeleteChat(s.id, e)}
                                  className="p-1 hover:text-destructive text-muted-foreground hover:bg-muted rounded"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="p-3 border-t border-border/60 bg-muted/20">
            <Button
              variant="outline"
              size="sm"
              onClick={handleClearAllHistory}
              disabled={sessions.length === 0}
              className="w-full gap-1.5 text-xs text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/20 h-8 justify-center"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Delete All History</span>
            </Button>
          </div>
        </aside>
      )}

      {/* Main Chat Workspace */}
      <div className="flex-1 flex flex-col h-full min-w-0 max-w-4xl mx-auto px-4 sm:px-6 py-6 overflow-hidden">
        <div className="pb-4 border-b border-border shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Chat</p>
              <div className="mt-1 flex items-center gap-2.5">
                <Logo size="sm" />
                <h1 className="font-serif text-3xl">Pip</h1>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Your social agent. Writes, designs, schedules and reports, all in your brand voice.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant={showHistory ? "secondary" : "outline"}
                size="sm"
                onClick={() => setShowHistory((v) => !v)}
                className="gap-1.5 text-xs h-8"
                title="Toggle chat history"
              >
                <History className="h-3.5 w-3.5" />
                <span>History</span>
                <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded-full font-mono">
                  {sessions.length}
                </span>
              </Button>
              <Button
                size="sm"
                onClick={handleNewChat}
                className="gap-1.5 text-xs h-8"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>New Chat</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDeleteCurrentChat}
                className="gap-1.5 text-xs h-8 text-muted-foreground hover:text-destructive hover:border-destructive/40"
                title="Delete current conversation"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Delete</span>
              </Button>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="text-muted-foreground uppercase tracking-wider mr-1">Context:</span>
            <span
              className={`rounded-full border px-2 py-0.5 ${meta.hasProfile ? "border-accent/40 bg-accent/10 text-foreground" : "border-border text-muted-foreground"}`}
            >
              Brand {meta.hasProfile ? "✓" : "—"}
            </span>
            <span
              className={`rounded-full border px-2 py-0.5 ${meta.hasGuideline ? "border-accent/40 bg-accent/10 text-foreground" : "border-border text-muted-foreground"}`}
            >
              Guide {meta.hasGuideline ? "✓" : "—"}
            </span>
            <span
              className={`rounded-full border px-2 py-0.5 ${meta.approvedImages ? "border-accent/40 bg-accent/10 text-foreground" : "border-border text-muted-foreground"}`}
            >
              {meta.approvedImages} visual ref{meta.approvedImages === 1 ? "" : "s"}
            </span>
            <span
              className={`rounded-full border px-2 py-0.5 inline-flex items-center gap-1 ${buffer?.connected ? "border-foreground text-foreground" : "border-border text-muted-foreground"}`}
            >
              <Share2 className="h-3 w-3" /> Channels{" "}
              {buffer?.connected ? `✓ ${buffer.channels.length}` : "—"}
            </span>
            <span className="text-muted-foreground">
              · {meta.chars.toLocaleString("en-US")} chars
            </span>
          {!meta.hasProfile && !meta.hasGuideline && (
            <Link
              to="/marca"
              className="ml-1 underline underline-offset-4 text-muted-foreground hover:text-foreground"
            >
              Configure brand
            </Link>
          )}
          {buffer && !buffer.connected && (
            <Link
              to="/conexiones"
              className="ml-1 underline underline-offset-4 text-muted-foreground hover:text-foreground"
            >
              Link channels
            </Link>
          )}
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto py-6 space-y-6">
        {messages.length === 0 && (
          <div className="space-y-6">
            <div className="space-y-3">
              <Logo size="md" />
              <h2 className="font-serif text-2xl text-foreground">Hi, this is Pip.</h2>
              <p className="text-sm text-muted-foreground">
                Tell me what to post and I will handle the writing, the visuals and the scheduling.
                What are we making today?
              </p>
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              {[
                "Create an Instagram post and schedule it for tomorrow at 10am",
                "What's trending this week in our industry?",
                "Move the LinkedIn one to Thursday afternoon",
                "Search the web for latest news on OpenAI",
              ].map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    pinnedToBottomRef.current = true;
                    sendMessage({ text: s });
                  }}
                  className="rounded-lg border border-border p-3 text-sm text-left hover:bg-muted transition"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => {
          const isUser = m.role === "user";
          return (
            <div key={m.id} className={isUser ? "flex justify-end" : "space-y-3"}>
              {isUser ? (
                <div className="max-w-[80%] space-y-2">
                  {m.parts.some((p) => p.type === "file") && (
                    <div className="flex flex-wrap gap-2 justify-end">
                      {m.parts.map((p, i) => {
                        if (p.type !== "file") return null;
                        const fp = p as {
                          type: "file";
                          mediaType?: string;
                          url: string;
                          filename?: string;
                        };
                        const isImg = fp.mediaType?.startsWith("image/");
                        return isImg ? (
                          <img
                            key={i}
                            src={fp.url}
                            alt={fp.filename ?? "attachment"}
                            className="rounded-lg max-h-48 border border-border"
                          />
                        ) : (
                          <div
                            key={i}
                            className="rounded-lg border border-border bg-muted px-3 py-2 text-xs flex items-center gap-2"
                          >
                            <FileText className="h-3.5 w-3.5" /> {fp.filename ?? "file"}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {m.parts.some((p) => p.type === "text") && (
                    <div className="rounded-2xl bg-foreground text-background px-4 py-2.5 whitespace-pre-wrap ml-auto w-fit">
                      {m.parts.map((p) => (p.type === "text" ? p.text : "")).join("")}
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {m.parts.map((p, i) => {
                    if (p.type === "text") {
                      const copyId = `${m.id}-${i}`;
                      return (
                        <div key={i} className="group relative">
                          <div className="prose prose-sm max-w-none text-foreground prose-headings:font-serif prose-headings:text-foreground prose-strong:text-foreground">
                            <ReactMarkdown>{p.text}</ReactMarkdown>
                          </div>
                          <button
                            type="button"
                            aria-label="Copy message"
                            onClick={() => copyToClipboard(copyId, p.text)}
                            className="absolute -top-1 right-0 opacity-0 group-hover:opacity-100 transition rounded-md border border-border bg-background/95 p-1.5 text-muted-foreground hover:text-foreground"
                          >
                            {copiedId === copyId ? (
                              <Check className="h-3 w-3" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </button>
                        </div>
                      );
                    }
                    if (p.type === "tool-webSearch") {
                      const input = p.input as { query?: string; recency?: string } | undefined;
                      const out = p.output as
                        | {
                            ok?: boolean;
                            results?: Array<{
                              title: string;
                              url: string;
                              snippet: string;
                              date?: string;
                            }>;
                            error?: string;
                          }
                        | undefined;
                      const done = p.state === "output-available";
                      return (
                        <div
                          key={i}
                          className="rounded-xl border border-border bg-muted/40 p-4 space-y-2"
                        >
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <Search className="h-4 w-4" />
                            {done
                              ? out?.ok
                                ? `Sources · ${out.results?.length ?? 0}${input?.query ? ` · "${input.query}"` : ""}`
                                : `Search failed: ${out?.error ?? "unknown"}`
                              : `Searching the web${input?.query ? ` for "${input.query}"` : ""}…`}
                          </div>
                          {done && out?.ok && out.results && out.results.length > 0 && (
                            <ul className="space-y-2">
                              {out.results.map((r, k) => {
                                const safeUrl = safeHttpUrl(r.url);
                                return (
                                  <li key={k} className="text-sm">
                                    {safeUrl ? (
                                      <a
                                        href={safeUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 font-medium text-foreground hover:underline underline-offset-4"
                                      >
                                        {r.title} <ExternalLink className="h-3 w-3 opacity-60" />
                                      </a>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 font-medium text-foreground">
                                        {r.title}
                                      </span>
                                    )}
                                    <div className="text-[11px] text-muted-foreground truncate">
                                      {/* safeUrl is already proven parseable, so this cannot
                                          throw. Parsing r.url directly would: search results
                                          are third-party data, and new URL() throws on
                                          anything without a scheme, which would take the whole
                                          chat transcript down mid-render. */}
                                      {safeUrl ? new URL(safeUrl).hostname : r.url}
                                      {r.date
                                        ? ` · ${new Date(r.date).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit" })}`
                                        : ""}
                                    </div>
                                    {r.snippet && (
                                      <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                                        {r.snippet}
                                      </p>
                                    )}
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </div>
                      );
                    }
                    if (p.type === "tool-showLibrary") {
                      const out = p.output as
                        | {
                            ok?: boolean;
                            count?: number;
                            items?: Array<{
                              id: string;
                              name: string;
                              approved: boolean;
                              analysis?: string;
                            }>;
                          }
                        | undefined;
                      const done = p.state === "output-available";
                      return (
                        <LibraryPicker
                          key={i}
                          done={done}
                          items={out?.items ?? []}
                          count={out?.count ?? 0}
                          resolveSrc={(id) => imageStashRef.current.get(id)}
                          onInsert={(ids) => {
                            const ref = ids.map((x) => `\`${x}\``).join(", ");
                            setInput(
                              (cur) =>
                                (cur ? cur + " " : "") +
                                `Use image${ids.length > 1 ? "s" : ""} ${ref} and create a variation.`,
                            );
                            taRef.current?.focus();
                          }}
                        />
                      );
                    }
                    if (p.type === "tool-generateVideo") {
                      const out = p.output as
                        | {
                            ok?: boolean;
                            videoId?: string;
                            durationSec?: number;
                            error?: string;
                            note?: string;
                          }
                        | undefined;
                      const done = p.state === "output-available";
                      const job = videoJobs[p.toolCallId];
                      return (
                        <div
                          key={i}
                          className="rounded-xl border border-border bg-muted/40 p-4 space-y-2"
                        >
                          <div className="flex items-center gap-2 text-sm font-medium">
                            {done ? (
                              <ImageIcon className="h-4 w-4" />
                            ) : (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            )}
                            {!done
                              ? `${job?.label ?? "Rendering video…"}${typeof job?.progress === "number" ? ` ${job.progress}%` : ""} · usually 1–3 minutes`
                              : out?.ok
                                ? `Video ready · ${out.durationSec ?? "?"}s · saved to the library (pending approval)`
                                : `Video failed: ${out?.error ?? "unknown"}`}
                          </div>
                          {done && out?.ok && out.videoId && (
                            <>
                              {videoStashRef.current.get(out.videoId) && (
                                <video
                                  src={videoStashRef.current.get(out.videoId)}
                                  poster={imageStashRef.current.get(out.videoId)}
                                  controls
                                  playsInline
                                  preload="metadata"
                                  className="max-h-80 w-auto max-w-full rounded-md bg-black"
                                />
                              )}
                              <p className="font-mono text-[10px] text-muted-foreground">
                                id: {out.videoId}
                              </p>
                            </>
                          )}
                        </div>
                      );
                    }
                    if (p.type === "tool-generateImage") {
                      const input = p.input as GenImageArgs | undefined;
                      const out = p.output as
                        { ok?: boolean; imageId?: string; error?: string } | undefined;
                      const frame = out?.imageId ? imageFrames[out.imageId] : undefined;
                      const done = p.state === "output-available";
                      return (
                        <div
                          key={i}
                          className="rounded-xl border border-border bg-muted/40 p-4 space-y-2"
                        >
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <ImageIcon className="h-4 w-4" />
                            {done
                              ? out?.ok
                                ? "Image ready"
                                : `Image failed: ${out?.error ?? "unknown"}`
                              : "Generating image…"}
                          </div>
                          {input?.prompt && (
                            <p className="text-xs text-muted-foreground line-clamp-2">
                              {input.prompt}
                            </p>
                          )}
                          {frame?.dataUrl && (
                            <img
                              src={frame.dataUrl}
                              alt={input?.prompt ?? "generated"}
                              className={`rounded-lg w-full max-w-md transition-[filter] ${frame.final ? "blur-0" : "blur-xl"}`}
                            />
                          )}
                        </div>
                      );
                    }
                    if (p.type === "tool-schedulePost" || p.type === "tool-reschedulePost") {
                      const input = p.input as ScheduleArgs | undefined;
                      const out = p.output as
                        | { ok?: boolean; scheduledAt?: string | null; platform?: string }
                        | undefined;
                      const done = p.state === "output-available" && out?.ok;
                      const when = out?.scheduledAt ? new Date(out.scheduledAt) : null;
                      const isResched = p.type === "tool-reschedulePost";
                      return (
                        <div
                          key={i}
                          className="rounded-xl border border-border bg-muted/40 p-4 space-y-2"
                        >
                          <div className="flex items-center gap-2 text-sm font-medium">
                            {done ? (
                              <CalendarCheck2 className="h-4 w-4" />
                            ) : (
                              <CalendarClock className="h-4 w-4 animate-pulse" />
                            )}
                            {done
                              ? when
                                ? `${isResched ? "Rescheduled" : "Scheduled"} on ${out?.platform} · ${when.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`
                                : "Saved as draft"
                              : isResched
                                ? "Rescheduling…"
                                : "Scheduling…"}
                          </div>
                          {input?.caption && (
                            <p className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-4">
                              {input.caption}
                            </p>
                          )}
                          {done && (
                            <Link
                              to="/calendario"
                              className="inline-block text-xs underline underline-offset-4"
                            >
                              View in calendar
                            </Link>
                          )}
                        </div>
                      );
                    }
                    if (p.type === "tool-deletePost") {
                      const out = p.output as
                        { ok?: boolean; platform?: string; caption?: string } | undefined;
                      return (
                        <div
                          key={i}
                          className="rounded-xl border border-border bg-muted/40 p-3 text-sm flex items-center gap-2"
                        >
                          <CalendarX2 className="h-4 w-4" />
                          {out?.ok ? `Deleted (${out.platform}): "${out.caption}"` : "Deleting…"}
                        </div>
                      );
                    }
                    if (p.type === "tool-listScheduled") {
                      const out = p.output as
                        | {
                            ok?: boolean;
                            items?: Array<{
                              id: string;
                              platform: string;
                              scheduledAt: string | null;
                              status?: string;
                              caption: string;
                            }>;
                          }
                        | undefined;
                      return (
                        <div
                          key={i}
                          className="rounded-xl border border-border bg-muted/40 p-4 space-y-2"
                        >
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <ListChecks className="h-4 w-4" /> Calendar
                          </div>
                          {out?.items?.length ? (
                            <ul className="space-y-1.5 text-sm">
                              {out.items.map((it) => (
                                <li key={it.id} className="flex gap-3">
                                  <span className="text-muted-foreground tabular-nums shrink-0">
                                    {it.scheduledAt
                                      ? new Date(it.scheduledAt).toLocaleString("en-US", {
                                          weekday: "short",
                                          day: "2-digit",
                                          month: "short",
                                          hour: "2-digit",
                                          minute: "2-digit",
                                        })
                                      : "draft"}
                                  </span>
                                  <span className="capitalize text-foreground/70 shrink-0">
                                    {it.platform}
                                  </span>
                                  {it.status &&
                                    it.status !== "scheduled" &&
                                    it.status !== "published" && (
                                      <span className="shrink-0 rounded-full border border-border px-1.5 text-[10px] text-muted-foreground self-center">
                                        {it.status.replace("_", " ")}
                                      </span>
                                    )}
                                  <span className="truncate">{it.caption}</span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-sm text-muted-foreground">No posts in that range.</p>
                          )}
                        </div>
                      );
                    }
                    if (p.type === "tool-bufferSchedulePost") {
                      // Shape must match what the tool handler actually returns
                      // (results + channels, since one call fans out to many
                      // channels). Reading a single-channel shape here is what
                      // rendered "Published to Buffer · undefined · undefined".
                      const out = p.output as
                        | {
                            ok?: boolean;
                            error?: string;
                            hasImage?: boolean;
                            hasVideo?: boolean;
                            results?: Array<{
                              channelId: string;
                              ok: boolean;
                              postId?: string;
                              dueAt?: string;
                              mode?: string;
                              error?: string;
                            }>;
                            channels?: Array<{ id: string; service: string; name: string }>;
                          }
                        | undefined;
                      const done = p.state === "output-available";
                      const results = out?.results ?? [];
                      const nameFor = (channelId: string) => {
                        const ch = out?.channels?.find((c) => c.id === channelId);
                        return ch ? `${ch.name} (${ch.service})` : channelId;
                      };
                      const okResults = results.filter((r) => r.ok);
                      const failed = results.filter((r) => !r.ok);
                      const media = out?.hasVideo ? "video" : out?.hasImage ? "image" : null;
                      return (
                        <div
                          key={i}
                          className="rounded-xl border border-foreground bg-foreground/[0.03] p-4 space-y-2"
                        >
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <Share2 className="h-4 w-4" />
                            {!done
                              ? "Publishing…"
                              : out?.ok
                                ? `Published · ${okResults.length} channel${okResults.length === 1 ? "" : "s"}${failed.length ? ` · ${failed.length} failed` : ""}${media ? ` · ${media} attached` : ""}`
                                : `Publish error: ${out?.error ?? failed[0]?.error ?? "unknown"}`}
                          </div>
                          {done &&
                            okResults.map((r) => (
                              <p key={r.channelId} className="text-[11px] text-muted-foreground">
                                {nameFor(r.channelId)} ·{" "}
                                {r.mode === "shareNow"
                                  ? "publishing now"
                                  : r.dueAt
                                    ? `${r.mode === "addToQueue" ? "queue slot " : ""}${new Date(r.dueAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`
                                    : "next queue slot"}
                                {r.postId ? <span className="font-mono"> · {r.postId}</span> : null}
                              </p>
                            ))}
                          {done &&
                            failed.map((r) => (
                              <p key={r.channelId} className="text-[11px] text-destructive">
                                {nameFor(r.channelId)} · {r.error ?? "rejected"}
                              </p>
                            ))}
                        </div>
                      );
                    }
                    if (p.type === "tool-bufferDeletePost") {
                      const out = p.output as
                        { ok?: boolean; bufferId?: string; error?: string } | undefined;
                      return (
                        <div
                          key={i}
                          className="rounded-xl border border-border bg-muted/40 p-3 text-sm flex items-center gap-2"
                        >
                          <Share2 className="h-4 w-4" />
                          {out?.ok
                            ? "Deleted from the channel queue"
                            : out?.error
                              ? `Error: ${out.error}`
                              : "Deleting…"}
                        </div>
                      );
                    }
                    return null;
                  })}
                </>
              )}
            </div>
          );
        })}

        {(status === "submitted" || status === "streaming") && (
          <div className="text-muted-foreground text-sm flex items-center justify-between py-2 px-3 rounded-lg bg-muted/40 border border-border">
            <div className="flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              <span>Thinking…</span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                stop();
                toast.info("Response stopped");
              }}
              className="h-7 text-xs text-destructive hover:bg-destructive/10"
            >
              Stop response
            </Button>
          </div>
        )}

        {status === "error" && (
          <div className="text-destructive text-sm flex items-center justify-between py-2 px-3 rounded-lg bg-destructive/10 border border-destructive/20">
            <span>Response encountered an error.</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleNewChat}
              className="h-7 text-xs"
            >
              Start New Chat
            </Button>
          </div>
        )}
      </div>

      <div
        className={`relative border-t border-border pt-3 pb-2 ${isDragging ? "bg-accent/5" : ""}`}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            setIsDragging(true);
          }
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setIsDragging(false);
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.files?.length) return;
          e.preventDefault();
          setIsDragging(false);
          acceptFiles(e.dataTransfer.files);
        }}
      >
        {isDragging && (
          <div className="absolute inset-0 z-10 rounded-lg border-2 border-dashed border-foreground bg-background/90 grid place-items-center pointer-events-none">
            <p className="text-sm font-medium">Drop images or PDFs to attach</p>
          </div>
        )}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 pb-2">
            {attachments.map((f, idx) => {
              const isImage = f.type.startsWith("image/");
              const url = isImage ? URL.createObjectURL(f) : null;
              return (
                <div
                  key={idx}
                  className="relative group rounded-lg border border-border bg-muted overflow-hidden"
                >
                  {url ? (
                    <img
                      src={url}
                      alt={f.name}
                      className="h-16 w-16 object-cover"
                      onLoad={() => URL.revokeObjectURL(url)}
                    />
                  ) : (
                    <div className="h-16 px-3 flex items-center gap-2 text-xs">
                      <FileText className="h-4 w-4" />
                      <span className="max-w-[140px] truncate">{f.name}</span>
                    </div>
                  )}
                  <button
                    type="button"
                    aria-label={`Remove ${f.name}`}
                    onClick={() => setAttachments((cur) => cur.filter((_, i) => i !== idx))}
                    className="absolute top-0.5 right-0.5 rounded-full bg-background/95 p-0.5 opacity-90 hover:opacity-100"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {/* Stop Generation Banner when running */}
        {(status === "submitted" || status === "streaming") && (
          <div className="flex items-center justify-center mb-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                stop();
                toast.info("Generation stopped");
              }}
              className="gap-1.5 text-xs bg-background/95 shadow-sm border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive h-8 px-3.5 rounded-full"
            >
              <Square className="h-3 w-3 fill-destructive" /> Stop generation
            </Button>
          </div>
        )}

        <div className="rounded-xl border border-border bg-background shadow-sm focus-within:ring-2 focus-within:ring-ring/50 focus-within:border-foreground/30 transition-all">
          <div className="flex gap-1 items-end px-2 py-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => {
                acceptFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Attach file"
              className="shrink-0 h-9 w-9 text-muted-foreground hover:text-foreground"
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip className="h-4 w-4" />
            </Button>
            <Textarea
              ref={taRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  if (status === "submitted" || status === "streaming") {
                    e.preventDefault();
                    stop();
                    toast.info("Generation stopped");
                    return;
                  }
                  if (attachments.length) {
                    e.preventDefault();
                    setAttachments([]);
                    return;
                  }
                }
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              onPaste={(e) => {
                const files: File[] = [];
                for (const item of Array.from(e.clipboardData.items)) {
                  if (item.kind === "file") {
                    const f = item.getAsFile();
                    if (f) files.push(f);
                  }
                }
                if (files.length) {
                  e.preventDefault();
                  acceptFiles(files);
                }
              }}
              placeholder="Write, paste, or drop images / PDFs…"
              rows={1}
              className="resize-none min-h-[44px] max-h-40 border-0 shadow-none focus-visible:ring-0 bg-transparent px-1"
            />
            {status === "submitted" || status === "streaming" ? (
              <Button
                type="button"
                onClick={() => {
                  stop();
                  toast.info("Generation stopped");
                }}
                size="icon"
                aria-label="Stop generation"
                title="Stop generation (Esc)"
                className="shrink-0 h-9 w-9 bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors shadow-sm rounded-lg"
              >
                <Square className="h-4 w-4 fill-current" />
              </Button>
            ) : (
              <Button
                onClick={() => {
                  void send();
                }}
                disabled={!input.trim() && attachments.length === 0}
                size="icon"
                aria-label="Send message"
                className="shrink-0 h-9 w-9 rounded-lg"
              >
                <Send className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  </div>
  );
}
