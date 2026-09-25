import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useScheduledPosts, scheduleStore } from "@/lib/schedule-store";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/lib/workspace";
import { bufferPublishApprovedPost } from "@/lib/buffer.functions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Check, X, ShieldCheck, Trash2 } from "lucide-react";

export const Route = createFileRoute("/approvals")({
  head: () => ({
    meta: [
      { title: "Approvals · Autonomous posts awaiting review" },
      {
        name: "description",
        content:
          "Review, edit and approve the posts your agent drafted autonomously before they go out.",
      },
      { property: "og:title", content: "Approvals · Autonomous posts awaiting review" },
      {
        property: "og:description",
        content:
          "Review, edit and approve the posts your agent drafted autonomously before they go out.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ApprovalsPage,
});

function ApprovalsPage() {
  const posts = useScheduledPosts();
  const { activeWorkspaceId } = useWorkspace();
  const [tab, setTab] = useState<"pending" | "rejected">("pending");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [publishingId, setPublishingId] = useState<string | null>(null);

  const pending = useMemo(() => posts.filter((p) => p.status === "pending_approval"), [posts]);
  const rejected = useMemo(() => posts.filter((p) => p.status === "rejected"), [posts]);
  const list = tab === "pending" ? pending : rejected;

  const approve = async (id: string) => {
    const caption = drafts[id];
    const item = posts.find((p) => p.id === id);
    const localPatch = {
      status: "scheduled" as const,
      ...(caption !== undefined && item ? { post: { ...item.post, caption } } : {}),
    };
    if (!activeWorkspaceId) {
      // No workspace, no database: the store keeps this in memory only, so
      // there is no second writer to race with.
      const local = await scheduleStore.update(id, localPatch);
      if (!local.ok) {
        toast.error("Approval not saved — the post is still waiting for you.");
        return;
      }
      toast.success("Approved — the post is now on the calendar.");
      return;
    }
    setPublishingId(id);
    try {
      // Claim the approval before anything else: flip to 'scheduled' only if the
      // post is still pending, and ask for the row back. A second click, a
      // second tab, or the agent approving at the same moment gets no row and
      // stops here, so the post is published once and not once per approver.
      // This write also persists the edited caption, which the publish server fn
      // reads back — and it refuses anything not persisted as 'scheduled'.
      const { data: claimed, error } = await supabase
        .from("scheduled_posts")
        .update({
          status: "scheduled",
          ...(caption !== undefined && item ? { post: { ...item.post, caption } as never } : {}),
        })
        .eq("id", id)
        .eq("status", "pending_approval")
        .select("id")
        .maybeSingle();
      if (error) {
        toast.error(`Could not save the approval: ${error.message}`);
        return;
      }
      if (!claimed) {
        toast("Already handled — this post was approved or rejected a moment ago.");
        void scheduleStore.refresh();
        return;
      }
      // The approval is saved. Bring the on-screen list in line with it; if that
      // mirror write fails it is a display problem, not a reason to withhold the
      // publish, so the outcome is not checked here.
      await scheduleStore.update(id, localPatch);

      const res = await bufferPublishApprovedPost({
        data: { workspaceId: activeWorkspaceId, postId: id },
      });
      if (res.ok) {
        toast.success(`Approved and published${res.channelName ? ` (${res.channelName})` : ""}.`);
        void scheduleStore.refresh(); // pick up buffer_id written by the publisher
      } else {
        // The approval stands either way — Buffer trouble must not undo it.
        toast(`Approved — internal calendar only: ${res.error ?? "publishing failed."}`);
      }
    } catch (e) {
      toast(
        `Approved — internal calendar only: ${e instanceof Error ? e.message : "publishing failed."}`,
      );
    } finally {
      setPublishingId(null);
    }
  };
  // Both await the store write: a rejection that failed to save must not be
  // reported as done, or the post quietly reappears on the next load.
  const reject = async (id: string) => {
    if (!activeWorkspaceId) {
      const res = await scheduleStore.update(id, { status: "rejected" });
      if (!res.ok) {
        toast.error("Could not reject this post — it is still waiting for you.");
        return;
      }
      toast("Rejected — kept for reference, not scheduled.");
      return;
    }
    // Same conditional claim as approve. Two rejects at once are harmless, but
    // a reject racing an approve is not: without the filter the later write wins
    // silently, and a post already on its way to Buffer would sit here looking
    // rejected.
    const { data: claimed, error } = await supabase
      .from("scheduled_posts")
      .update({ status: "rejected" })
      .eq("id", id)
      .eq("status", "pending_approval")
      .select("id")
      .maybeSingle();
    if (error) {
      toast.error("Could not reject this post — it is still waiting for you.");
      return;
    }
    if (!claimed) {
      toast("Already handled — this post was approved or rejected a moment ago.");
      void scheduleStore.refresh();
      return;
    }
    // Saved. The store write only mirrors it on screen.
    await scheduleStore.update(id, { status: "rejected" });
    toast("Rejected — kept for reference, not scheduled.");
  };
  const restore = async (id: string) => {
    const res = await scheduleStore.update(id, { status: "pending_approval" });
    if (!res.ok) toast.error("Could not move this post back to pending.");
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="pb-4 border-b border-border">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Studio</p>
        <h1 className="mt-1 font-serif text-3xl flex items-center gap-2">
          <ShieldCheck className="h-6 w-6" /> Approvals
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Posts the agent wrote on its own. Nothing here reaches the calendar or your channels until
          you approve it.
        </p>
      </div>

      <div className="mt-4 flex gap-2">
        {(["pending", "rejected"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`text-xs px-3 py-1.5 rounded border ${tab === t ? "border-foreground text-foreground" : "border-border text-muted-foreground"}`}
          >
            {t === "pending"
              ? `Waiting for you (${pending.length})`
              : `Rejected (${rejected.length})`}
          </button>
        ))}
      </div>

      {list.length === 0 && (
        <p className="mt-6 text-sm text-muted-foreground border border-dashed border-border rounded-lg p-10 text-center">
          {tab === "pending"
            ? "Nothing waiting. The agent has no drafts pending review."
            : "No rejected drafts."}
        </p>
      )}

      <ul className="mt-6 space-y-4">
        {list.map((p) => (
          <li key={p.id} className="border border-border rounded-lg p-4">
            <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
              <Badge variant="outline" className="uppercase">
                {p.post.platform}
              </Badge>
              {p.scheduledAt && (
                <span>Proposed for {new Date(p.scheduledAt).toLocaleString("en-US")}</span>
              )}
              {p.note && <span className="italic">· {p.note}</span>}
            </div>
            <div className="mt-3 flex gap-4">
              {p.imageDataUrl && (
                <img
                  src={p.imageDataUrl}
                  alt={`Visual for the ${p.post.platform} post`}
                  className="w-28 h-28 object-cover rounded border border-border"
                  loading="lazy"
                />
              )}
              <div className="flex-1 min-w-0">
                {tab === "pending" ? (
                  <Textarea
                    rows={6}
                    value={drafts[p.id] ?? p.post.caption}
                    onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                  />
                ) : (
                  <p className="text-sm whitespace-pre-wrap">{p.post.caption}</p>
                )}
                {!!p.post.hashtags?.length && (
                  <p className="mt-2 text-xs text-muted-foreground">{p.post.hashtags.join(" ")}</p>
                )}
              </div>
            </div>
            <div className="mt-3 flex gap-2 justify-end">
              {tab === "pending" ? (
                <>
                  <Button size="sm" variant="outline" onClick={() => reject(p.id)}>
                    <X className="h-4 w-4 mr-1" /> Reject
                  </Button>
                  <Button size="sm" onClick={() => approve(p.id)} disabled={publishingId === p.id}>
                    <Check className="h-4 w-4 mr-1" />{" "}
                    {publishingId === p.id ? "Publishing…" : "Approve & schedule"}
                  </Button>
                </>
              ) : (
                <>
                  <Button size="sm" variant="ghost" onClick={() => scheduleStore.remove(p.id)}>
                    <Trash2 className="h-4 w-4 mr-1" /> Delete
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => restore(p.id)}>
                    Move back to pending
                  </Button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
