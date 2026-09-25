import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { scheduleStore } from "@/lib/schedule-store";
import type { GeneratedPost } from "@/lib/types";
import {
  bufferGetStatus,
  bufferCreatePost,
  type BufferChannel,
  type ChannelPostOptions,
} from "@/lib/buffer.functions";
import { BufferChannelOptions, channelOptionWarning } from "@/components/buffer-channel-options";
import { useServerFn } from "@tanstack/react-start";
import { useWorkspace } from "@/lib/workspace";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { CalendarClock, FileText, Loader2, AlertTriangle, Send } from "lucide-react";
import { cn } from "@/lib/utils";

type Destination = "internal" | "buffer";

function toISOWithOffset(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

function buildText(post: GeneratedPost): string {
  const tags = post.hashtags.length
    ? `\n\n${post.hashtags.map((t) => (t.startsWith("#") ? t : `#${t}`)).join(" ")}`
    : "";
  const cta = post.cta ? `\n\n${post.cta}` : "";
  return `${post.caption}${cta}${tags}`.trim();
}

export function ScheduleDialog({
  open,
  onOpenChange,
  post,
  imageDataUrl,
  videoUrl,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  post: GeneratedPost;
  imageDataUrl?: string | null;
  videoUrl?: string | null;
  /** Called once the post is actually persisted — as a draft, an internal
   * schedule, or at least one real Buffer publish. Callers that track
   * "unsaved work" (e.g. the navigation guard on /crear) use this to know
   * the post is safe now, as opposed to the dialog merely closing. */
  onSaved?: () => void;
}) {
  const { activeWorkspaceId } = useWorkspace();
  const getStatus = useServerFn(bufferGetStatus);
  const createBufferPost = useServerFn(bufferCreatePost);

  const [date, setDate] = useState<Date | undefined>(() => {
    const d = new Date();
    d.setHours(d.getHours() + 1, 0, 0, 0);
    return d;
  });
  const [time, setTime] = useState("10:00");
  const [note, setNote] = useState("");
  const [destination, setDestination] = useState<Destination>("internal");
  const [channels, setChannels] = useState<BufferChannel[]>([]);
  const [channelsErr, setChannelsErr] = useState<string | null>(null);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [selectedChannels, setSelectedChannels] = useState<Set<string>>(new Set());
  const [perChannel, setPerChannel] = useState<Record<string, ChannelPostOptions>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !activeWorkspaceId) return;
    setChannelsLoading(true);
    getStatus({ data: { workspaceId: activeWorkspaceId } })
      .then((s) => {
        setChannels(s.channels);
        setChannelsErr(
          s.error ?? (s.connected ? null : "Publishing is not connected in this workspace."),
        );
        if (s.channels.length > 0) {
          setSelectedChannels((prev) => (prev.size ? prev : new Set([s.channels[0].id])));
        }
      })
      .catch((e) => setChannelsErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setChannelsLoading(false));
  }, [open, getStatus, activeWorkspaceId]);

  const toggleChannel = (id: string) => {
    setSelectedChannels((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const composeDate = (): Date | null => {
    if (!date) return null;
    const [h, m] = time.split(":").map(Number);
    const d = new Date(date);
    d.setHours(h ?? 10, m ?? 0, 0, 0);
    return d;
  };

  const saveDraft = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await scheduleStore.add({
        post,
        imageDataUrl: imageDataUrl ?? undefined,
        videoUrl: videoUrl ?? undefined,
        scheduledAt: null,
        status: "draft",
        note: note.trim() || undefined,
      });
      if (!result.ok) {
        // scheduleStore.add already surfaced the failure toast. Keep the
        // dialog open with the brief and image intact so the user can retry
        // without redoing the work.
        return;
      }
      toast.success("Saved as draft.", {
        action: {
          label: "View",
          onClick: () => {
            window.location.href = "/calendario";
          },
        },
      });
      onSaved?.();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  const confirmSchedule = async () => {
    if (busy) return;
    const when = composeDate();
    if (!when) {
      toast.error("Pick a date.");
      return;
    }
    if (when.getTime() < Date.now() - 60_000) {
      toast.error("That time is in the past.");
      return;
    }

    if (destination === "internal") {
      setBusy(true);
      try {
        const result = await scheduleStore.add({
          post,
          imageDataUrl: imageDataUrl ?? undefined,
          videoUrl: videoUrl ?? undefined,
          scheduledAt: when.getTime(),
          status: "scheduled",
          note: note.trim() || undefined,
        });
        if (!result.ok) {
          // scheduleStore.add already toasted the failure. Leave the dialog
          // open — closing it here is what let a failed write masquerade as
          // a success with no way to retry.
          return;
        }
        toast.success("Scheduled on the calendar.", {
          action: {
            label: "View",
            onClick: () => {
              window.location.href = "/calendario";
            },
          },
        });
        onSaved?.();
        onOpenChange(false);
      } finally {
        setBusy(false);
      }
      return;
    }

    // Buffer
    if (!activeWorkspaceId) {
      toast.error("No active workspace.");
      return;
    }
    const ids = Array.from(selectedChannels);
    if (ids.length === 0) {
      toast.error("Pick at least one channel.");
      return;
    }
    const media = { hasImage: !!imageDataUrl, hasVideo: !!videoUrl };
    for (const id of ids) {
      const ch = channels.find((c) => c.id === id);
      const warn = ch ? channelOptionWarning(ch.service, perChannel[id], media) : null;
      if (warn) {
        toast.error(`${ch?.name}: ${warn}`);
        return;
      }
    }
    setBusy(true);
    try {
      const iso = toISOWithOffset(when);
      const sel: Record<string, ChannelPostOptions> = {};
      for (const id of ids) if (perChannel[id]) sel[id] = perChannel[id];
      const result = await createBufferPost({
        data: {
          workspaceId: activeWorkspaceId,
          channelIds: ids,
          text: buildText(post),
          scheduledAtISO: iso,
          imageDataUrl: imageDataUrl ?? undefined,
          videoUrl: videoUrl ?? undefined,
          ...(Object.keys(sel).length ? { perChannel: sel } : {}),
        },
      });
      let ok = 0,
        failed = 0;
      let localSaveFailed = 0;
      for (const r of result.results) {
        if (!r.ok) {
          failed++;
          continue;
        }
        ok++;
        // The publish itself already happened for real (r.ok came from
        // Buffer's own response) — this just mirrors it into the local
        // calendar. Await it so a failure here doesn't get papered over by
        // the "Scheduled" toast below: scheduleStore.add already raises its
        // own toast, we just need to know whether to add a clarifying one.
        const mirrored = await scheduleStore.add({
          post,
          imageDataUrl: imageDataUrl ?? undefined,
          videoUrl: videoUrl ?? undefined,
          scheduledAt: when.getTime(),
          status: "scheduled",
          note: note.trim() || undefined,
          bufferId: r.postId,
          bufferChannelId: r.channelId,
        });
        if (!mirrored.ok) localSaveFailed++;
      }
      if (ok > 0) {
        toast.success(
          `Scheduled · ${ok} channel${ok === 1 ? "" : "s"}${failed ? ` · ${failed} failed` : ""}`,
          {
            action: {
              label: "View",
              onClick: () => {
                window.location.href = "/calendario";
              },
            },
          },
        );
        if (localSaveFailed > 0) {
          toast.error(
            `It published, but ${localSaveFailed} of ${ok} didn't save to your calendar view. It's still live — refresh /calendar to see it.`,
            { duration: 10000 },
          );
        }
        onSaved?.();
        onOpenChange(false);
      } else {
        const firstErr = result.results.find((r) => r.error)?.error ?? "Scheduling failed.";
        toast.error(firstErr, { duration: 10000 });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Scheduling failed.";
      console.error("[schedule-dialog] buffer failed", e);
      toast.error(msg, { duration: 10000 });
    } finally {
      setBusy(false);
    }
  };

  const hasChannels = channels.length > 0;
  const bufferDisabled = !hasChannels && !channelsLoading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl">Schedule post</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Publish to
            </Label>
            <RadioGroup
              value={destination}
              onValueChange={(v) => setDestination(v as Destination)}
              className="space-y-2"
            >
              <div className="flex items-start gap-2 border border-border p-3">
                <RadioGroupItem value="internal" id="dest-internal" className="mt-0.5" />
                <Label htmlFor="dest-internal" className="font-normal cursor-pointer flex-1">
                  <span className="block">Internal calendar only</span>
                  <span className="block text-xs text-muted-foreground mt-0.5">
                    Track it in this app. Won't publish to any social network.
                  </span>
                </Label>
              </div>
              <div
                className={cn(
                  "flex items-start gap-2 border border-border p-3",
                  bufferDisabled && "opacity-60",
                )}
              >
                <RadioGroupItem
                  value="buffer"
                  id="dest-buffer"
                  disabled={bufferDisabled}
                  className="mt-0.5"
                />
                <Label
                  htmlFor="dest-buffer"
                  className={cn(
                    "font-normal flex-1",
                    bufferDisabled ? "cursor-not-allowed" : "cursor-pointer",
                  )}
                >
                  <span className="block">Your channels (real publish)</span>
                  <span className="block text-xs text-muted-foreground mt-0.5">
                    {channelsLoading
                      ? "Checking channels…"
                      : channelsErr
                        ? channelsErr
                        : hasChannels
                          ? `${channels.length} channel${channels.length === 1 ? "" : "s"} available.`
                          : "No channels linked yet."}
                  </span>
                </Label>
              </div>
            </RadioGroup>

            {destination === "buffer" && hasChannels && (
              <div className="space-y-2 pt-1">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Channels ({selectedChannels.size}/{channels.length})
                </Label>
                <div className="border border-border divide-y divide-border max-h-72 overflow-y-auto">
                  {channels.map((c) => (
                    <div key={c.id}>
                      <label className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/40">
                        <Checkbox
                          checked={selectedChannels.has(c.id)}
                          onCheckedChange={() => toggleChannel(c.id)}
                        />
                        <span className="uppercase font-mono text-[10px] text-muted-foreground w-16 shrink-0">
                          {c.service}
                        </span>
                        <span className="text-sm truncate flex-1">{c.name}</span>
                      </label>
                      {selectedChannels.has(c.id) && (
                        <BufferChannelOptions
                          channel={c}
                          value={perChannel[c.id]}
                          onChange={(next) => setPerChannel((p) => ({ ...p, [c.id]: next }))}
                          media={{ hasImage: !!imageDataUrl, hasVideo: !!videoUrl }}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {bufferDisabled && (
              <div className="flex items-start gap-2 text-xs text-muted-foreground border border-dashed border-border p-3">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>
                  Connect a publishing account (and at least one channel) first.{" "}
                  <Link to="/conexiones" className="underline">
                    Open Connections
                  </Link>
                </span>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Date</Label>
            <div className="rounded-md border border-border p-2">
              <Calendar
                mode="single"
                selected={date}
                onSelect={setDate}
                initialFocus
                className={cn("p-1 pointer-events-auto")}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Time</Label>
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Note (optional)
            </Label>
            <Textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="E.g. Coordinate with the product team."
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2 flex-col sm:flex-row">
          <Button variant="outline" onClick={saveDraft} className="gap-2" disabled={busy}>
            <FileText className="h-4 w-4" /> Save as draft
          </Button>
          <Button onClick={confirmSchedule} className="gap-2" disabled={busy}>
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : destination === "buffer" ? (
              <Send className="h-4 w-4" />
            ) : (
              <CalendarClock className="h-4 w-4" />
            )}
            {destination === "buffer"
              ? `Publish${selectedChannels.size > 1 ? ` (×${selectedChannels.size})` : ""}`
              : "Schedule"}
          </Button>
        </DialogFooter>

        <p className="text-xs text-muted-foreground text-center">
          Posts are tracked in{" "}
          <Link to="/calendario" className="underline">
            /calendar
          </Link>
          .
        </p>
      </DialogContent>
    </Dialog>
  );
}
