import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { BufferChannel, ChannelPostOptions, InstagramPostType } from "@/lib/buffer.functions";
import { AlertTriangle, MessageSquarePlus } from "lucide-react";

const IG_TYPES: Array<{ value: InstagramPostType; label: string }> = [
  { value: "post", label: "Post" },
  { value: "reel", label: "Reel" },
  { value: "story", label: "Story" },
];

export const FIRST_COMMENT_SERVICES = new Set(["instagram", "linkedin", "facebook"]);

/** Client-side mirror of the server guardrails, so people see the problem before sending. */
export function channelOptionWarning(
  service: string,
  opts: ChannelPostOptions | undefined,
  media: { hasImage: boolean; hasVideo: boolean },
): string | null {
  if (service.toLowerCase() !== "instagram") return null;
  const type = opts?.instagramType ?? "post";
  if (type === "reel" && !media.hasVideo) return "Reels need a video attached.";
  if (type === "story" && !media.hasVideo && !media.hasImage)
    return "Stories need an image or a video.";
  if (type === "post" && !media.hasImage && !media.hasVideo) return "Instagram posts need media.";
  return null;
}

export function BufferChannelOptions({
  channel,
  value,
  onChange,
  media,
}: {
  channel: BufferChannel;
  value: ChannelPostOptions | undefined;
  onChange: (next: ChannelPostOptions) => void;
  media: { hasImage: boolean; hasVideo: boolean };
}) {
  const service = channel.service.toLowerCase();
  const isInstagram = service === "instagram";
  const type = value?.instagramType ?? "post";
  const supportsComment = FIRST_COMMENT_SERVICES.has(service) && !(isInstagram && type === "story");
  const [commentOpen, setCommentOpen] = useState(!!value?.firstComment);
  const warning = channelOptionWarning(service, value, media);

  if (!isInstagram && !supportsComment) return null;

  const set = (patch: Partial<ChannelPostOptions>) => onChange({ ...(value ?? {}), ...patch });

  return (
    <div className="space-y-2 px-3 pb-3 pt-1">
      {isInstagram && (
        <div className="flex items-center gap-1">
          {IG_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => set({ instagramType: t.value })}
              className={cn(
                "px-2.5 py-1 text-xs border border-border transition-colors",
                type === t.value ? "bg-foreground text-background" : "hover:bg-muted",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {isInstagram && type === "reel" && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
          <Checkbox
            checked={value?.shouldShareToFeed ?? true}
            onCheckedChange={(v) => set({ shouldShareToFeed: !!v })}
          />
          Also share the reel to the feed
        </label>
      )}

      {warning && (
        <p className="flex items-start gap-1.5 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" /> {warning}
        </p>
      )}

      {supportsComment &&
        (commentOpen ? (
          <div className="space-y-1">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              First comment
            </Label>
            <Textarea
              rows={2}
              value={value?.firstComment ?? ""}
              onChange={(e) => set({ firstComment: e.target.value })}
              placeholder="Posted as the first comment — good place for links."
              maxLength={3000}
            />
            <p className="text-[10px] text-muted-foreground text-right">
              {(value?.firstComment ?? "").length}/3000
            </p>
          </div>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
            onClick={() => setCommentOpen(true)}
          >
            <MessageSquarePlus className="h-3.5 w-3.5" /> Add first comment
          </Button>
        ))}
    </div>
  );
}
