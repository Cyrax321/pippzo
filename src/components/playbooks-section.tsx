import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  listPlaybooks,
  savePlaybook,
  resetPlaybook,
  type PlaybookPublic,
} from "@/lib/playbooks.functions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { SectionDisclosure } from "@/components/section-disclosure";
import { Loader2, BookOpen, RotateCcw, ChevronDown, AlertTriangle, RefreshCw } from "lucide-react";

export function PlaybooksSection({ workspaceId }: { workspaceId: string | null }) {
  const list = useServerFn(listPlaybooks);
  const save = useServerFn(savePlaybook);
  const reset = useServerFn(resetPlaybook);

  const [items, setItems] = useState<PlaybookPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!workspaceId) return;
    setLoading(true);
    setLoadError(null);
    list({ data: { workspaceId } })
      .then((r) => setItems(r.playbooks))
      .catch((e) => setLoadError(e instanceof Error ? e.message : "Could not load playbooks."))
      .finally(() => setLoading(false));
  }, [workspaceId, list]);

  useEffect(load, [load]);

  const update = (slug: string, patch: Partial<PlaybookPublic>) =>
    setItems((cur) => cur.map((p) => (p.slug === slug ? { ...p, ...patch } : p)));

  const onSave = async (p: PlaybookPublic) => {
    if (!workspaceId) return;
    setBusy(p.slug);
    try {
      const body = drafts[p.slug] ?? p.body;
      await save({ data: { workspaceId, slug: p.slug, body, enabled: p.enabled } });
      update(p.slug, { body, overridden: body.trim() !== p.defaultBody.trim() });
      toast.success(`${p.name} updated`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(null);
    }
  };

  const onReset = async (p: PlaybookPublic) => {
    if (!workspaceId) return;
    setBusy(p.slug);
    try {
      await reset({ data: { workspaceId, slug: p.slug } });
      update(p.slug, { body: p.defaultBody, overridden: false, enabled: true });
      setDrafts((d) => ({ ...d, [p.slug]: p.defaultBody }));
      toast.success("Reset to the default instructions");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not reset");
    } finally {
      setBusy(null);
    }
  };

  return (
    <SectionDisclosure
      icon={<BookOpen className="h-4 w-4" />}
      title={<>Playbooks</>}
      subtitle="Custom instructions per capability"
    >
      <div className="px-5 py-5 space-y-5">
        <p className="text-sm text-muted-foreground">
          Playbooks are the standing instructions the agent reads before it acts. Voice and learning
          rules load on every turn; the others load when the matching capability is in play. Edit
          one to change behaviour everywhere at once — chat, the Create page and autonomous runs all
          read the same text.
        </p>

        {loading ? (
          <p className="text-xs text-muted-foreground inline-flex items-center gap-2">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading
          </p>
        ) : loadError ? (
          <div className="flex items-start justify-between gap-3 text-xs border border-dashed border-destructive/50 px-4 py-3">
            <span className="flex items-start gap-2 text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              Couldn&rsquo;t load playbooks: {loadError}
            </span>
            <Button variant="ghost" size="sm" className="gap-1.5 shrink-0" onClick={load}>
              <RefreshCw className="h-3.5 w-3.5" /> Retry
            </Button>
          </div>
        ) : items.length === 0 ? (
          <p className="text-xs text-muted-foreground border border-dashed border-border px-4 py-3">
            No playbooks found for this workspace.
          </p>
        ) : (
          <ul className="divide-y divide-border border border-border">
            {items.map((p) => {
              const isOpen = open === p.slug;
              return (
                <li key={p.slug}>
                  <div className="flex items-center justify-between gap-3 px-4 py-3">
                    <button
                      type="button"
                      className="flex items-start gap-2 text-left min-w-0"
                      onClick={() => {
                        setOpen(isOpen ? null : p.slug);
                        setDrafts((d) => ({ ...d, [p.slug]: d[p.slug] ?? p.body }));
                      }}
                    >
                      <ChevronDown
                        className={`h-4 w-4 mt-0.5 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
                      />
                      <span className="min-w-0">
                        <span className="text-sm font-medium block">
                          {p.name}
                          {p.overridden && (
                            <span className="ml-2 font-mono text-[10px] border border-foreground px-1.5 py-0.5">
                              CUSTOM
                            </span>
                          )}
                        </span>
                        <span className="text-[11px] text-muted-foreground block">
                          {p.description}
                        </span>
                      </span>
                    </button>
                    <Switch
                      checked={p.enabled}
                      onCheckedChange={async (v) => {
                        update(p.slug, { enabled: v });
                        if (!workspaceId) return;
                        try {
                          await save({
                            data: {
                              workspaceId,
                              slug: p.slug,
                              body: drafts[p.slug] ?? p.body,
                              enabled: v,
                            },
                          });
                        } catch {
                          update(p.slug, { enabled: !v });
                          toast.error("Could not update");
                        }
                      }}
                    />
                  </div>

                  {isOpen && (
                    <div className="px-4 pb-4 space-y-3">
                      <Textarea
                        value={drafts[p.slug] ?? p.body}
                        onChange={(e) => setDrafts((d) => ({ ...d, [p.slug]: e.target.value }))}
                        rows={12}
                        className="font-mono text-xs"
                      />
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          onClick={() => onSave(p)}
                          disabled={busy === p.slug || !workspaceId}
                        >
                          {busy === p.slug ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            "Save"
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="gap-1.5"
                          onClick={() => onReset(p)}
                          disabled={busy === p.slug || !p.overridden}
                        >
                          <RotateCcw className="h-3.5 w-3.5" /> Reset to default
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </SectionDisclosure>
  );
}
