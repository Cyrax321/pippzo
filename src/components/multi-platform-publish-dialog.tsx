import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { publishNowMultiPlatformFn } from "@/lib/social/social-publisher.functions";
import type {
  SocialPlatformKey,
  SocialStatusMap,
  MultiPlatformPublishResult,
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
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import {
  Send,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ExternalLink,
  Calendar,
} from "lucide-react";

export function MultiPlatformPublishDialog({
  open,
  onOpenChange,
  workspaceId,
  platforms,
  statusMap,
  text,
  imageDataUrl,
  videoUrl,
  onPublished,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string | null;
  platforms: SocialPlatformKey[];
  statusMap: SocialStatusMap | null;
  text: string;
  imageDataUrl?: string | null;
  videoUrl?: string | null;
  onPublished?: () => void;
}) {
  const publishNow = useServerFn(publishNowMultiPlatformFn);
  const [publishing, setPublishing] = useState(false);
  const [result, setResult] = useState<MultiPlatformPublishResult | null>(null);

  const handlePublish = async () => {
    if (!workspaceId) {
      toast.error("No active workspace.");
      return;
    }
    if (platforms.length === 0) {
      toast.error("Select at least one platform.");
      return;
    }
    if (!text.trim()) {
      toast.error("Post text cannot be empty.");
      return;
    }

    setPublishing(true);
    setResult(null);

    try {
      const res = await publishNow({
        data: {
          workspaceId,
          platforms,
          text: text.trim(),
          imageDataUrl: imageDataUrl || undefined,
          videoUrl: videoUrl || undefined,
        },
      });

      setResult(res);

      if (res.overallOk) {
        toast.success(
          `Published successfully to ${res.publishedCount} of ${platforms.length} platform${
            platforms.length === 1 ? "" : "s"
          }!`,
        );
        onPublished?.();
      } else {
        toast.error("Failed to publish to selected platforms.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Publishing failed.");
    } finally {
      setPublishing(false);
    }
  };

  const handleClose = () => {
    if (publishing) return;
    setResult(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-serif text-2xl">
            <Send className="h-5 w-5 text-primary" />
            Publish to All Platforms Now
          </DialogTitle>
          <DialogDescription>
            This will immediately post your content simultaneously to all {platforms.length} selected
            network{platforms.length === 1 ? "" : "s"}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Target Platforms List */}
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Target Networks ({platforms.length})
            </label>
            <div className="grid grid-cols-2 gap-2">
              {platforms.map((p) => {
                const cfg = SOCIAL_PLATFORM_CONFIG[p];
                const acc = statusMap?.[p];
                const platformRes = result?.results.find((r) => r.platform === p);

                return (
                  <div
                    key={p}
                    className="border border-border p-2.5 rounded-md flex items-center justify-between text-xs bg-muted/20"
                  >
                    <div className="flex items-center gap-2 truncate">
                      <span className={`w-5 h-5 rounded flex items-center justify-center font-bold text-[10px] ${cfg.color}`}>
                        {cfg.icon}
                      </span>
                      <div className="truncate">
                        <p className="font-medium truncate">{cfg.label}</p>
                        <p className="text-[10px] text-muted-foreground truncate">
                          {acc?.connected ? (
                            acc?.username || acc?.name || "Connected"
                          ) : (
                            <Link to="/conexiones" className="text-primary hover:underline">
                              Get key &amp; connect →
                            </Link>
                          )}
                        </p>
                      </div>
                    </div>

                    {result ? (
                      platformRes?.ok ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                      ) : (
                        <XCircle className="h-4 w-4 text-destructive shrink-0" />
                      )
                    ) : acc?.connected ? (
                      <span className="text-[10px] font-mono text-emerald-500 uppercase font-semibold">Ready</span>
                    ) : (
                      <span className="text-[10px] font-mono text-amber-500 uppercase font-semibold">Unlinked</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Results Summary if Published */}
          {result && (
            <div className="border border-border p-3.5 rounded-lg space-y-2.5 bg-muted/40">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground">
                Publishing Outcome ({result.publishedCount}/{platforms.length} succeeded)
              </h4>
              <div className="space-y-1.5 divide-y divide-border/60">
                {result.results.map((r) => {
                  const cfg = SOCIAL_PLATFORM_CONFIG[r.platform];
                  return (
                    <div key={r.platform} className="pt-1.5 flex items-start justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span>{cfg.icon}</span>
                        <strong className="text-foreground">{cfg.label}</strong>
                      </div>
                      <div className="text-right">
                        {r.ok ? (
                          <span className="text-emerald-500 font-medium inline-flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" /> Live
                            {r.postId && <span className="font-mono text-[10px]">({r.postId.slice(0, 10)})</span>}
                          </span>
                        ) : (
                          <span className="text-destructive text-[11px] font-normal block max-w-[300px] text-right" title={r.error}>
                            {r.error || "Failed"}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Content Preview */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Post Content
            </label>
            <div className="p-3 bg-muted/30 border border-border rounded-md text-xs whitespace-pre-wrap max-h-36 overflow-y-auto">
              {text}
            </div>
            {imageDataUrl && (
              <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                <span>🖼️ 1 image attached</span>
              </p>
            )}
            {videoUrl && (
              <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                <span>🎬 1 video attached</span>
              </p>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          {result?.overallOk ? (
            <div className="flex w-full items-center justify-between">
              <Link to="/calendario" className="text-xs underline text-muted-foreground hover:text-foreground">
                View on Calendar
              </Link>
              <Button onClick={handleClose}>Done</Button>
            </div>
          ) : (
            <>
              <Button variant="outline" onClick={handleClose} disabled={publishing}>
                Cancel
              </Button>
              <Button onClick={handlePublish} disabled={publishing} className="gap-2">
                {publishing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Publishing to all {platforms.length} platforms...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" />
                    Confirm &amp; Publish to All ({platforms.length})
                  </>
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
