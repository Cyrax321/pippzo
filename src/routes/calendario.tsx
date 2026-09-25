import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  scheduleStore,
  useScheduledPosts,
  publishState,
  type PublishState,
  type ScheduledPost,
} from "@/lib/schedule-store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  ChevronLeft,
  ChevronRight,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Clock,
  HelpCircle,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { PostEditor } from "@/components/post-editor";

export const Route = createFileRoute("/calendario")({
  head: () => ({
    meta: [
      { title: "Calendar · Social Studio" },
      { name: "description", content: "Editorial calendar." },
    ],
  }),
  component: CalendarPage,
});

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function startOfMonthGrid(d: Date) {
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - offset);
  start.setHours(0, 0, 0, 0);
  return start;
}
function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function platformColor(p: string) {
  switch (p) {
    case "linkedin":
      return "bg-blue-100 text-blue-900 border-blue-200";
    case "instagram":
      return "bg-pink-100 text-pink-900 border-pink-200";
    case "tiktok":
      return "bg-zinc-200 text-zinc-900 border-zinc-300";
    case "x":
      return "bg-neutral-200 text-neutral-900 border-neutral-300";
    case "facebook":
      return "bg-indigo-100 text-indigo-900 border-indigo-200";
    default:
      return "bg-muted text-foreground border-border";
  }
}

// How each of the five states reads on a chip roughly 120px wide and 11px tall.
//
// Five is a lot for something that small, so only what a person scanning a
// month actually needs to act on is on the chip; the reason, the channel and
// what to do about it are in the detail view the chip opens. What has to be
// distinguishable at a glance is:
//
//   - the two states that need somebody (failed, unknown), because they need
//     OPPOSITE actions: fix it and publish again, versus go and look before
//     touching anything. Merging them into one "needs attention" chip would
//     hand back exactly the ambiguity finding 54 removed.
//   - out versus not out yet (sent, queued), which is finding 53.
//
// Every state carries a word as well as a glyph and a colour, so nothing here
// depends on colour — or on an icon a screen reader will not read — alone. The
// plain "scheduled" chip is the only one with no word: it is the resting state
// and labelling it would just add noise to every other chip on the calendar.
type ChipStyle = {
  /** The word on the chip. Empty only for the resting "scheduled" state. */
  label: string;
  Icon: LucideIcon | null;
  /** The whole chip, when the state overrides the platform colour. */
  box: string | null;
  /** Appended to the platform colour when `box` is null. */
  tone: string;
  /** The caption line under the header. */
  caption: string;
};

const CHIP: Record<PublishState, ChipStyle> = {
  sent: {
    label: "Sent",
    Icon: CheckCircle2,
    box: null,
    tone: "opacity-60",
    // Struck through because it is finished — the treatment "live" posts have
    // always had here, now reserved for posts that really have gone out.
    caption: "text-foreground/80 line-through",
  },
  queued: {
    label: "Queued",
    Icon: Clock,
    box: null,
    // Deliberately NOT dimmed or struck through: it has not happened yet.
    tone: "",
    caption: "text-foreground/80",
  },
  scheduled: { label: "", Icon: null, box: null, tone: "", caption: "text-foreground/80" },
  failed: {
    label: "Failed",
    Icon: AlertTriangle,
    box: "border-2 border-dashed border-destructive bg-destructive/10 text-destructive font-semibold",
    tone: "",
    caption: "text-destructive/80",
  },
  unknown: {
    label: "Unknown",
    Icon: HelpCircle,
    // Dotted rather than dashed, amber rather than red: it reads as "stop and
    // look", not as "this is broken", which is the honest difference.
    box: "border-2 border-dotted border-amber-600 bg-amber-500/10 text-amber-700 dark:text-amber-400 font-semibold",
    tone: "",
    caption: "text-amber-700/80 dark:text-amber-400/80",
  },
};

/** The full account, for the detail view the chip opens. */
function stateDetail(state: PublishState, whenLabel: string): string {
  switch (state) {
    case "sent":
      return `Your channel accepted this post and its time (${whenLabel}) has passed, so it has gone out.`;
    case "queued":
      return `Your channel accepted this post and is holding it in the queue until ${whenLabel}. It has NOT gone out yet.`;
    case "failed":
      return "The channel was asked to publish this and refused, so nothing went out. Fix whatever it objected to and publish it again.";
    case "unknown":
      return "The publish request was sent and no answer came back, so we do not know whether this went out. Check this channel at publish.buffer.com before publishing it again — if it did go out, publishing again puts a second copy on a live channel.";
    default:
      return "This is on your calendar only. Nothing has been sent to a channel yet.";
  }
}

function CalendarPage() {
  const items = useScheduledPosts();
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d;
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  // Read once per render rather than on a timer. The only transition it drives
  // is queued -> sent, so a stale value can only ever understate what has gone
  // out — and understating is the safe direction: "Queued" on a post that has
  // just gone out costs nothing, while "Sent" on one that has not is the claim
  // finding 53 exists to remove.
  const nowMs = Date.now();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const gridStart = useMemo(() => startOfMonthGrid(cursor), [cursor]);
  const days = useMemo(
    () =>
      Array.from({ length: 42 }, (_, i) => {
        const d = new Date(gridStart);
        d.setDate(gridStart.getDate() + i);
        return d;
      }),
    [gridStart],
  );

  // Drafts awaiting approval (or rejected) never show on the calendar.
  const scheduled = items.filter(
    (i) => i.scheduledAt !== null && i.status !== "pending_approval" && i.status !== "rejected",
  );
  const drafts = items.filter((i) => i.scheduledAt === null);

  const itemsByDay = useMemo(() => {
    const map = new Map<string, ScheduledPost[]>();
    scheduled.forEach((s) => {
      const d = new Date(s.scheduledAt!);
      const k = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const arr = map.get(k) ?? [];
      arr.push(s);
      map.set(k, arr);
    });
    return map;
  }, [scheduled]);

  const onDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
  };
  const onDrop = async (e: React.DragEvent, day: Date) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain");
    if (!id) return;
    const existing = scheduleStore.getAll().find((p) => p.id === id);
    const base = existing?.scheduledAt ? new Date(existing.scheduledAt) : new Date();
    const d = new Date(day);
    d.setHours(base.getHours(), base.getMinutes(), 0, 0);
    setDragOver(null);
    const moved = await scheduleStore.reschedule(id, d.getTime());
    // Dragging a live post moves the calendar entry only. The post already
    // queued on the channel keeps the time it was given — saying nothing here
    // would let the calendar claim a move that did not happen upstream.
    if (moved.bufferTimeUnchanged) {
      toast.warning(
        "Moved on your calendar only. This post is already live on its channel and will still go out at its original time — unpublish it and publish again to change that.",
        { duration: 8000 },
      );
    }
  };

  const sel = items.find((i) => i.id === selected) ?? null;

  // One pass, five honest numbers. The bug this replaces: "Published" counted
  // anything Buffer had accepted, so a post queued for tomorrow was reported as
  // published today (finding 53), and "Needs attention" folded a publish we
  // could not account for in with one that definitely failed (finding 54).
  const counts = useMemo(() => {
    const c = { scheduled: 0, queued: 0, sent: 0, failed: 0, unknown: 0 };
    items.forEach((i) => {
      const state = publishState(i, nowMs);
      if (state === "scheduled") {
        // Only a dated post the user actually scheduled counts here; undated
        // drafts have their own line below and must not be counted twice.
        if (i.scheduledAt !== null && i.status === "scheduled") c.scheduled += 1;
        return;
      }
      c[state] += 1;
    });
    return c;
  }, [items, nowMs]);

  return (
    <div className="px-6 py-10 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Calendar</p>
          <h1 className="mt-2 font-serif text-4xl">
            {MONTHS[cursor.getMonth()]} {cursor.getFullYear()}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setCursor((d) => {
                const n = new Date(d);
                n.setMonth(n.getMonth() - 1);
                return n;
              })
            }
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const d = new Date();
              d.setDate(1);
              setCursor(d);
            }}
          >
            Today
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setCursor((d) => {
                const n = new Date(d);
                n.setMonth(n.getMonth() + 1);
                return n;
              })
            }
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_280px] gap-6">
        <div className="rounded-lg border border-border overflow-hidden bg-card">
          <div className="grid grid-cols-7 border-b border-border bg-muted/50">
            {DAYS.map((d) => (
              <div
                key={d}
                className="px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground"
              >
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 grid-rows-6">
            {days.map((day) => {
              const k = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
              const dayItems = itemsByDay.get(k) ?? [];
              const inMonth = day.getMonth() === cursor.getMonth();
              const isToday = sameDay(day, today);
              const isOver = dragOver === k;
              return (
                <div
                  key={k}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(k);
                  }}
                  onDragLeave={() => setDragOver((v) => (v === k ? null : v))}
                  onDrop={(e) => void onDrop(e, day)}
                  className={`min-h-[110px] border-r border-b border-border p-1.5 space-y-1 transition-colors ${
                    inMonth ? "bg-background" : "bg-muted/30"
                  } ${isOver ? "bg-accent/10 ring-1 ring-accent inset" : ""}`}
                >
                  <div
                    className={`text-xs ${isToday ? "font-bold text-accent" : inMonth ? "text-foreground" : "text-muted-foreground"}`}
                  >
                    {day.getDate()}
                  </div>
                  {dayItems.map((it) => {
                    const state = publishState(it, nowMs);
                    const style = CHIP[state];
                    const Icon = style.Icon;
                    const chipVariant =
                      style.box ?? `border ${platformColor(it.post.platform)} ${style.tone}`;
                    const at = new Date(it.scheduledAt!).toLocaleTimeString("en-US", {
                      hour: "2-digit",
                      minute: "2-digit",
                    });
                    return (
                      <button
                        key={it.id}
                        draggable
                        onDragStart={(e) => onDragStart(e, it.id)}
                        onClick={() => setSelected(it.id)}
                        className={`w-full text-left text-[11px] leading-tight rounded px-1.5 py-1 cursor-grab active:cursor-grabbing ${chipVariant}`}
                      >
                        <div className="flex items-center gap-1">
                          {Icon ? <Icon className="h-3 w-3 shrink-0" aria-hidden="true" /> : null}
                          <span className="truncate font-medium capitalize">
                            {it.post.platform} · {at}
                          </span>
                          {/* The state word never truncates: it is the part that
                              says whether anything is wrong. The platform and
                              time give way to it when the cell is narrow. */}
                          {style.label ? (
                            <span className="ml-auto shrink-0 text-[9px] font-semibold uppercase tracking-wide">
                              {style.label}
                            </span>
                          ) : null}
                        </div>
                        <div className={`truncate ${style.caption}`}>
                          {it.post.caption.slice(0, 50)}
                        </div>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        <aside className="space-y-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Summary</p>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span>Drafts</span>
                <Badge variant="secondary">{drafts.length}</Badge>
              </div>
              <div className="flex justify-between">
                <span>Scheduled here</span>
                <Badge variant="secondary">{counts.scheduled}</Badge>
              </div>
              <div className="flex justify-between">
                <span>Queued at channel</span>
                <Badge variant="secondary">{counts.queued}</Badge>
              </div>
              <div className="flex justify-between">
                <span>Published</span>
                <Badge variant="secondary">{counts.sent}</Badge>
              </div>
              <div className="pt-2 mt-1 border-t border-border space-y-2">
                <div className="flex justify-between">
                  <span>Publishing failed</span>
                  <Badge variant={counts.failed > 0 ? "destructive" : "secondary"}>
                    {counts.failed}
                  </Badge>
                </div>
                <div className="flex justify-between">
                  <span>Outcome unknown</span>
                  <Badge
                    variant="secondary"
                    className={
                      counts.unknown > 0
                        ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                        : undefined
                    }
                  >
                    {counts.unknown}
                  </Badge>
                </div>
                {counts.unknown > 0 ? (
                  <p className="text-[11px] text-muted-foreground">
                    We could not confirm these went out. Check the channel before publishing any of
                    them again.
                  </p>
                ) : null}
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
              Unscheduled drafts
            </p>
            {drafts.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Empty.{" "}
                <Link to="/crear" className="underline">
                  Create a post
                </Link>{" "}
                and save it as a draft.
              </p>
            ) : (
              <ul className="space-y-2">
                {drafts.map((d) => (
                  <li
                    key={d.id}
                    draggable
                    onDragStart={(e) => onDragStart(e, d.id)}
                    onClick={() => setSelected(d.id)}
                    className={`text-xs rounded border px-2 py-1.5 cursor-grab active:cursor-grabbing ${platformColor(d.post.platform)}`}
                  >
                    <div className="font-medium capitalize">{d.post.platform}</div>
                    <div className="truncate text-foreground/80">{d.post.caption.slice(0, 60)}</div>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-[11px] text-muted-foreground">
              Drag them onto a day in the calendar.
            </p>
          </div>

          <Link to="/crear" className="block">
            <Button variant="outline" className="w-full gap-2">
              <Sparkles className="h-4 w-4" /> Create post
            </Button>
          </Link>
        </aside>
      </div>

      <Dialog open={!!sel} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="sm:max-w-3xl max-h-[88vh] overflow-y-auto">
          {sel && (
            <>
              <DialogHeader>
                <DialogTitle className="font-serif text-2xl capitalize">
                  {sel.post.platform}
                </DialogTitle>
              </DialogHeader>
              {/* The chip only had room to name the state. This is where it is
                  spelled out — what the channel did, and what to do next. */}
              {(() => {
                const state = publishState(sel, nowMs);
                const style = CHIP[state];
                const Icon = style.Icon;
                const when = sel.scheduledAt
                  ? new Date(sel.scheduledAt).toLocaleString("en-US")
                  : "the next free slot in the channel queue";
                return (
                  <div
                    className={`flex gap-2 rounded-md border p-3 text-xs ${
                      state === "failed"
                        ? "border-destructive/40 bg-destructive/10 text-destructive"
                        : state === "unknown"
                          ? "border-amber-600/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                          : "border-border bg-muted/40 text-muted-foreground"
                    }`}
                  >
                    {Icon ? <Icon className="h-4 w-4 shrink-0 mt-px" aria-hidden="true" /> : null}
                    <p>
                      <span className="font-semibold">
                        {style.label || "On your calendar"}
                        {" — "}
                      </span>
                      {stateDetail(state, when)}
                    </p>
                  </div>
                );
              })()}
              <div className="mt-2">
                <PostEditor item={sel} onClose={() => setSelected(null)} />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
