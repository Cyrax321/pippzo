import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { scheduleMultiPlatformFn } from "@/lib/social/social-publisher.functions";
import type {
  SocialPlatformKey,
  SocialStatusMap,
} from "@/lib/social/social-types";
import { SOCIAL_PLATFORM_CONFIG } from "@/lib/social/social-types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { CalendarClock, Loader2, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

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

export function MultiPlatformScheduleDialog({
  open,
  onOpenChange,
  workspaceId,
  platforms,
  statusMap,
  text,
  imageDataUrl,
  videoUrl,
  onScheduled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string | null;
  platforms: SocialPlatformKey[];
  statusMap: SocialStatusMap | null;
  text: string;
  imageDataUrl?: string | null;
  videoUrl?: string | null;
  onScheduled?: () => void;
}) {
  const scheduleMulti = useServerFn(scheduleMultiPlatformFn);

  const [date, setDate] = useState<Date | undefined>(() => {
    const d = new Date();
    d.setHours(d.getHours() + 1, 0, 0, 0);
    return d;
  });
  const [time, setTime] = useState("10:00");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const composeDate = (): Date | null => {
    if (!date) return null;
    const [h, m] = time.split(":").map(Number);
    const d = new Date(date);
    d.setHours(h ?? 10, m ?? 0, 0, 0);
    return d;
  };

  const handleConfirmSchedule = async () => {
    if (!workspaceId) {
      toast.error("No active workspace.");
      return;
    }
    if (platforms.length === 0) {
      toast.error("Select at least one platform.");
      return;
    }
    const when = composeDate();
    if (!when) {
      toast.error("Please pick a schedule date.");
      return;
    }
    if (when.getTime() < Date.now() - 60_000) {
      toast.error("Scheduled time cannot be in the past.");
      return;
    }

    setBusy(true);
    try {
      const scheduledAtISO = toISOWithOffset(when);
      const res = await scheduleMulti({
        data: {
          workspaceId,
          platforms,
          text: text.trim(),
          scheduledAtISO,
          imageDataUrl: imageDataUrl || undefined,
          videoUrl: videoUrl || undefined,
          note: note.trim() || undefined,
        },
      });

      if (res.ok) {
        toast.success(
          `Successfully scheduled across ${res.scheduledCount} of ${platforms.length} platform${
            platforms.length === 1 ? "" : "s"
          }!`,
          {
            action: {
              label: "View Calendar",
              onClick: () => {
                window.location.href = "/calendario";
              },
            },
          },
        );
        onScheduled?.();
        onOpenChange(false);
      } else {
        toast.error(`Scheduling failed: ${res.errors.join(", ")}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to schedule post.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-serif text-2xl">
            <CalendarClock className="h-5 w-5 text-primary" />
            Schedule to All Platforms
          </DialogTitle>
          <DialogDescription>
            Pick a date and time. All {platforms.length} selected platforms will be queued to post at that exact instant.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Target Platforms Badge List */}
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Scheduling for ({platforms.length} networks)
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {platforms.map((p) => {
                const cfg = SOCIAL_PLATFORM_CONFIG[p];
                return (
                  <span
                    key={p}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs border border-border bg-muted/40 font-medium"
                  >
                    <span>{cfg.icon}</span>
                    <span>{cfg.label}</span>
                  </span>
                );
              })}
            </div>
          </div>

          {/* Date Picker */}
          <div className="space-y-1.5">
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

          {/* Time input */}
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Time</Label>
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>

          {/* Note input */}
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Internal Note (optional)
            </Label>
            <Textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Simultaneous Q4 product announcement"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleConfirmSchedule} disabled={busy} className="gap-2">
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CalendarClock className="h-4 w-4" />
            )}
            Schedule to All ({platforms.length})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
