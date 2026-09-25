import { safeHttpUrl } from "@/lib/safe-url";
import { normalizeWebsiteUrl } from "@/lib/website-url";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { competitorsStore, useCompetitors, type Competitor } from "@/lib/competitors-store";
import { scanCompetitor } from "@/lib/competitors.functions";
import { scanCompetitorV2 } from "@/lib/scrapecreators.functions";
import { brandContextSummary } from "@/lib/brand-store";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { toast } from "sonner";
import { Plus, Loader2, RefreshCw, Trash2, Sparkles, BarChart3, ExternalLink } from "lucide-react";

export const Route = createFileRoute("/competidores")({
  head: () => ({
    meta: [
      { title: "Competitors · Pippzo" },
      { name: "description", content: "Competitive analysis." },
    ],
  }),
  component: CompetitorsPage,
});

type Handles = { instagram?: string; tiktok?: string; x?: string; linkedin?: string };

function CompetitorsPage() {
  const items = useCompetitors();
  const scan = useServerFn(scanCompetitor);
  const scanV2 = useServerFn(scanCompetitorV2);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [scanningId, setScanningId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: "",
    website: "",
    linkedin: "",
    instagram: "",
    tiktok: "",
    x: "",
    facebook: "",
    ig_handle: "",
    tt_handle: "",
    x_handle: "",
    li_url: "",
  });

  const submit = async () => {
    if (!form.name.trim()) {
      toast.error("Name is required.");
      return;
    }
    // Finding 52: "example.com" is how most people type a website, and stored
    // raw it is not a URL at all. Normalise it to https:// here, and refuse a
    // value that cannot be made into one while the dialog is still open, so the
    // user can fix the typo instead of losing it.
    const website = normalizeWebsiteUrl(form.website);
    if (!website.ok) {
      toast.error(website.error);
      return;
    }
    const handles: Handles = {
      instagram: form.ig_handle.trim() || undefined,
      tiktok: form.tt_handle.trim() || undefined,
      x: form.x_handle.trim() || undefined,
      linkedin: form.li_url.trim() || undefined,
    };
    const c = await competitorsStore.add({
      name: form.name.trim(),
      website: website.url,
      socials: {
        linkedin: form.linkedin.trim() || undefined,
        instagram: form.instagram.trim() || undefined,
        tiktok: form.tiktok.trim() || undefined,
        x: form.x.trim() || undefined,
        facebook: form.facebook.trim() || undefined,
      },
      handles,
    });
    setForm({
      name: "",
      website: "",
      linkedin: "",
      instagram: "",
      tiktok: "",
      x: "",
      facebook: "",
      ig_handle: "",
      tt_handle: "",
      x_handle: "",
      li_url: "",
    });
    setOpen(false);
    await runScan(c, handles);
  };

  const runScan = async (c: Competitor, handlesOverride?: Handles) => {
    setScanningId(c.id);
    try {
      let handles = handlesOverride;
      if (!handles) {
        // Lookup saved handles for this competitor.
        const { data: row } = await supabase
          .from("competitors")
          .select("handles")
          .eq("id", c.id)
          .maybeSingle();
        handles = (row?.handles ?? {}) as Handles;
      }
      const hasHandles = Object.values(handles ?? {}).some(
        (v) => typeof v === "string" && v.trim(),
      );
      if (hasHandles) {
        const snap = await scanV2({
          data: { competitorId: c.id, ourBrandContext: brandContextSummary() },
        });
        competitorsStore.update(c.id, { snapshot: snap });
        toast.success(`${c.name} analyzed with real posts.`);
      } else {
        const snap = await scan({
          data: {
            name: c.name,
            ourBrandContext: brandContextSummary(),
            website: c.website,
            socials: c.socials,
          },
        });
        competitorsStore.update(c.id, { snapshot: snap });
        toast.success(`${c.name} analyzed.`);
      }
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Scan failed.");
    } finally {
      setScanningId(null);
    }
  };

  const inspirePost = (c: Competitor) => {
    const themes = c.snapshot?.recurringThemes?.slice(0, 2).join(", ") ?? "their content";
    const opp = c.snapshot?.opportunitiesForUs?.[0] ?? "differentiate ourselves through quality";
    const brief = `Inspired by ${c.name} (themes: ${themes}). Opportunity for us: ${opp}. Create a post that leverages this angle in our own voice.`;
    sessionStorage.setItem("sm.crear.prefilledBrief", brief);
    navigate({ to: "/crear" });
    setTimeout(() => {
      const ta = document.querySelector("textarea") as HTMLTextAreaElement | null;
      if (ta) {
        ta.value = brief;
        ta.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }, 200);
  };

  const sel = items.find((c) => c.id === selected) ?? null;

  return (
    <div className="mx-auto max-w-6xl px-6 py-12 space-y-10">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Competitors</p>
          <h1 className="mt-2 font-serif text-4xl">Competitive intelligence</h1>
          <p className="mt-2 text-muted-foreground">
            Add competitors, scan their public properties, and uncover opportunities.
          </p>
        </div>
        <Button onClick={() => setOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" /> Add competitor
        </Button>
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-16 text-center text-muted-foreground">
          <BarChart3 className="h-8 w-8 mx-auto mb-3" />
          <p>You haven't added any competitors yet.</p>
          <p className="text-xs mt-1">Start with 2-3 brands you admire or compete with directly.</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {items.map((c) => {
            const isScanning = scanningId === c.id;
            return (
              <div key={c.id} className="rounded-lg border border-border bg-card p-5 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-serif text-xl">{c.name}</h3>
                    {c.website &&
                      (safeHttpUrl(c.website) ? (
                        <a
                          href={safeHttpUrl(c.website)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                        >
                          {new URL(c.website).hostname} <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">{c.website}</span>
                      ))}
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => runScan(c)}
                      disabled={isScanning}
                      title="Re-scan"
                    >
                      {isScanning ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => {
                        competitorsStore.remove(c.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(c.socials).map(([k, v]) =>
                    v ? (
                      <Badge key={k} variant="outline" className="capitalize text-[10px]">
                        {k}
                      </Badge>
                    ) : null,
                  )}
                </div>

                {c.snapshot ? (
                  <>
                    <div className="space-y-1.5 text-sm">
                      <p>
                        <span className="text-muted-foreground text-xs uppercase tracking-wider">
                          Tone.
                        </span>{" "}
                        {c.snapshot.tone}
                      </p>
                      <p>
                        <span className="text-muted-foreground text-xs uppercase tracking-wider">
                          Frequency.
                        </span>{" "}
                        {c.snapshot.postingFrequency}
                      </p>
                    </div>
                    {c.snapshot.recurringThemes.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {c.snapshot.recurringThemes.slice(0, 5).map((t) => (
                          <Badge key={t} variant="secondary" className="text-[10px]">
                            {t}
                          </Badge>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        onClick={() => setSelected(c.id)}
                      >
                        View analysis
                      </Button>
                      <Button size="sm" className="gap-1 flex-1" onClick={() => inspirePost(c)}>
                        <Sparkles className="h-3.5 w-3.5" /> Inspired post
                      </Button>
                    </div>
                  </>
                ) : isScanning ? (
                  <div className="text-sm text-muted-foreground flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> Scanning public properties…
                  </div>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => runScan(c)} className="gap-2">
                    <Sparkles className="h-3.5 w-3.5" /> Scan now
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">Add competitor</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Competitor name…"
              />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Website
              </Label>
              <Input
                value={form.website}
                onChange={(e) => setForm({ ...form, website: e.target.value })}
                placeholder="example.com"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  LinkedIn
                </Label>
                <Input
                  value={form.linkedin}
                  onChange={(e) => setForm({ ...form, linkedin: e.target.value })}
                  placeholder="URL"
                />
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Instagram
                </Label>
                <Input
                  value={form.instagram}
                  onChange={(e) => setForm({ ...form, instagram: e.target.value })}
                  placeholder="URL"
                />
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  TikTok
                </Label>
                <Input
                  value={form.tiktok}
                  onChange={(e) => setForm({ ...form, tiktok: e.target.value })}
                  placeholder="URL"
                />
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">X</Label>
                <Input
                  value={form.x}
                  onChange={(e) => setForm({ ...form, x: e.target.value })}
                  placeholder="URL"
                />
              </div>
            </div>

            <div className="rounded-md border border-border/60 bg-muted/30 p-3 space-y-3">
              <div>
                <p className="text-xs uppercase tracking-wider text-accent">
                  Deep scan (real posts)
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Add handles for a much richer analysis based on actual recent posts and
                  engagement.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    IG handle
                  </Label>
                  <Input
                    value={form.ig_handle}
                    onChange={(e) => setForm({ ...form, ig_handle: e.target.value })}
                    placeholder="@brand"
                  />
                </div>
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    TikTok handle
                  </Label>
                  <Input
                    value={form.tt_handle}
                    onChange={(e) => setForm({ ...form, tt_handle: e.target.value })}
                    placeholder="@brand"
                  />
                </div>
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    X handle
                  </Label>
                  <Input
                    value={form.x_handle}
                    onChange={(e) => setForm({ ...form, x_handle: e.target.value })}
                    placeholder="@brand"
                  />
                </div>
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    LinkedIn URL
                  </Label>
                  <Input
                    value={form.li_url}
                    onChange={(e) => setForm({ ...form, li_url: e.target.value })}
                    placeholder="linkedin.com/company/…"
                  />
                </div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Without handles the scan falls back to Firecrawl on the URLs above.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submit}>Add and scan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail sheet */}
      <Sheet open={!!sel} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full sm:max-w-3xl overflow-y-auto p-0">
          {sel && sel.snapshot && <AnalysisReport c={sel} onInspire={() => inspirePost(sel)} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function AnalysisReport({ c, onInspire }: { c: Competitor; onInspire: () => void }) {
  const s = c.snapshot!;
  const networks = s.networks ?? {};
  const netEntries = Object.entries(networks);
  const totalPosts = netEntries.reduce((a, [, v]) => a + (v.posts_scanned ?? 0), 0);
  const hasRich =
    (s.positioning?.length ?? 0) > 0 ||
    !!s.contentStrategy ||
    (s.activityLog?.length ?? 0) > 0 ||
    (s.strengthsDetailed?.length ?? 0) > 0 ||
    (s.vulnerabilities?.length ?? 0) > 0 ||
    (s.keyTakeaways?.length ?? 0) > 0;

  return (
    <div className="px-8 py-10 space-y-12">
      {/* Hero */}
      <header className="space-y-4 pb-8 border-b border-border">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" /> Competitor analysis · File №
          {c.id.slice(0, 4).toUpperCase()}
        </div>
        <SheetHeader className="p-0">
          <SheetTitle className="font-serif text-5xl font-normal tracking-tight leading-[1.05]">
            {c.name}
          </SheetTitle>
        </SheetHeader>
        {s.subtitle && (
          <p className="font-serif italic text-lg text-muted-foreground">{s.subtitle}</p>
        )}
        {s.dek && (
          <p className="text-[15px] text-foreground/80 max-w-xl leading-relaxed">{s.dek}</p>
        )}

        {s.profileNote && (
          <div className="mt-6 border border-border border-t-[3px] border-t-accent bg-card p-6">
            <p className="text-sm text-foreground/80 leading-relaxed">{s.profileNote}</p>
          </div>
        )}

        {/* Stats strip */}
        {(s.stats?.length ?? 0) > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-border border border-border mt-6">
            {s.stats!.slice(0, 4).map((st, i) => (
              <div key={i} className="bg-card p-5">
                <div className="font-serif text-2xl text-accent leading-tight">{st.value}</div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1.5">
                  {st.label}
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground pt-2">
          Scanned {new Date(s.scannedAt).toLocaleString("en-US")} · {totalPosts} posts across{" "}
          {netEntries.length} networks
        </p>
      </header>

      {/* Legacy fallback — rendered when the scan didn't return the rich analyst layer */}
      {!hasRich && (
        <Section num="01" title="Overview" desc="Summary from an early/URL-only scan.">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-border border border-border">
            {s.tone && <StrategyCard label="Tone" body={s.tone} />}
            {s.postingFrequency && (
              <StrategyCard label="Posting frequency" body={s.postingFrequency} />
            )}
            {s.estimatedAudience && (
              <StrategyCard label="Estimated audience" body={s.estimatedAudience} />
            )}
            {(s.dominantFormats?.length ?? 0) > 0 && (
              <StrategyCard label="Dominant formats" body={s.dominantFormats.join(" · ")} />
            )}
          </div>

          {(s.recurringThemes?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-2 mt-6">
              {s.recurringThemes.map((t) => (
                <span
                  key={t}
                  className="text-[11px] tracking-wider px-3 py-1.5 border border-border bg-card text-foreground/70"
                >
                  {t}
                </span>
              ))}
            </div>
          )}

          {((s.strengths?.length ?? 0) > 0 || (s.weaknesses?.length ?? 0) > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-border border border-border mt-6">
              <div className="bg-card p-6">
                <span className="inline-block text-[11px] uppercase tracking-wider px-2.5 py-1 mb-4 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                  Strengths
                </span>
                <ul className="space-y-2 text-sm text-foreground/75">
                  {(s.strengths ?? []).map((it, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-accent">·</span>
                      <span>{it}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="bg-card p-6">
                <span className="inline-block text-[11px] uppercase tracking-wider px-2.5 py-1 mb-4 bg-amber-500/10 text-amber-700 dark:text-amber-400">
                  Weaknesses
                </span>
                <ul className="space-y-2 text-sm text-foreground/75">
                  {(s.weaknesses ?? []).map((it, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-accent">·</span>
                      <span>{it}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {(s.recentPosts?.length ?? 0) > 0 && (
            <div className="mt-6 border border-border">
              <div className="p-4 border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                Recent posts
              </div>
              <ul className="divide-y divide-border">
                {s.recentPosts.map((p, i) => (
                  <li key={i} className="p-4 text-sm text-foreground/80">
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>
      )}

      {/* 01 Positioning */}
      {(s.positioning?.length ?? 0) > 0 && (
        <Section
          num="01"
          title="Positioning & Authority"
          desc="Where the credibility actually comes from."
        >
          <div className="border border-border">
            {s.positioning!.map((row, i) => {
              const [head, ...rest] = row.value.split(/\.\s+/);
              const body = rest.join(". ").trim();
              return (
                <div
                  key={i}
                  className="grid grid-cols-1 md:grid-cols-[200px_1fr] border-t border-border first:border-t-0"
                >
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground p-5 bg-muted/40 flex items-center">
                    {row.label}
                  </div>
                  <div className="p-5 md:border-l border-border">
                    <b className="block font-serif text-[15px] font-medium mb-1">
                      {head.replace(/\.$/, "")}
                    </b>
                    {body && <span className="text-sm text-foreground/70">{body}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* 02 Content Strategy */}
      {s.contentStrategy && (
        <Section num="02" title="Content Strategy" desc="Recurring themes and how they publish.">
          {(s.recurringThemes?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-2 mb-6">
              {s.recurringThemes.map((t) => (
                <span
                  key={t}
                  className="text-[11px] tracking-wider px-3 py-1.5 border border-border bg-card text-foreground/70"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-border border border-border">
            <StrategyCard label="Cadence" body={s.contentStrategy.cadence} />
            <StrategyCard label="Format" body={s.contentStrategy.format} />
            <StrategyCard label="Voice" body={s.contentStrategy.voice} />
            <StrategyCard label="Recurring device" body={s.contentStrategy.recurringDevice} />
          </div>
        </Section>
      )}

      {/* 03 Activity log */}
      {(s.activityLog?.length ?? 0) > 0 && (
        <Section num="03" title="Recent Activity Log" desc="A window into publishing behavior.">
          <div className="border-l-2 border-border ml-1.5 pl-6 space-y-6">
            {s.activityLog!.map((e, i) => {
              let text: React.ReactNode = e.text;
              if (e.highlight && e.text.includes(e.highlight)) {
                const [a, b] = e.text.split(e.highlight);
                text = (
                  <>
                    {a}
                    <b className="text-foreground font-semibold">{e.highlight}</b>
                    {b}
                  </>
                );
              }
              return (
                <div key={i} className="relative">
                  <span className="absolute -left-[31px] top-1.5 h-2.5 w-2.5 rounded-full bg-accent" />
                  <div className="text-[11px] tracking-wider text-muted-foreground mb-1">
                    {e.date}
                    {e.network ? ` · ${e.network}` : ""}
                  </div>
                  <div className="text-sm text-foreground/80">
                    {text}
                    {safeHttpUrl(e.url) && (
                      <>
                        {" "}
                        <a
                          href={safeHttpUrl(e.url)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-accent hover:underline inline-flex items-center gap-0.5"
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* 04 Strengths / Vulnerabilities */}
      {((s.strengthsDetailed?.length ?? 0) > 0 || (s.vulnerabilities?.length ?? 0) > 0) && (
        <Section
          num="04"
          title="Strengths & Vulnerabilities"
          desc="Read purely as a competitive presence."
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-border border border-border">
            <SvColumn kind="strength" label="Strengths" items={s.strengthsDetailed ?? []} />
            <SvColumn kind="risk" label="Vulnerabilities" items={s.vulnerabilities ?? []} />
          </div>
        </Section>
      )}

      {/* 05 Key takeaways */}
      {(s.keyTakeaways?.length ?? 0) > 0 && (
        <Section num="05" title="Key Takeaways" desc="What this profile actually tells us.">
          <div className="border-t border-border">
            {s.keyTakeaways!.map((t, i) => (
              <div
                key={i}
                className="grid grid-cols-[52px_1fr] gap-5 py-5 border-b border-border items-start"
              >
                <div className="font-serif text-2xl text-border">
                  {String(i + 1).padStart(2, "0")}
                </div>
                <div>
                  <h5 className="font-serif text-base font-medium mb-1">{t.title}</h5>
                  <p className="text-sm text-foreground/70 max-w-xl">{t.body}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Opportunities CTA */}
      {(s.opportunitiesForUs?.length ?? 0) > 0 && (
        <Section num="06" title="Opportunities for us" desc="Angles our brand can own.">
          <ul className="space-y-2 mb-6">
            {s.opportunitiesForUs.map((o, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <span className="text-accent">·</span>
                <span>{o}</span>
              </li>
            ))}
          </ul>
          <Button onClick={onInspire} className="gap-2">
            <Sparkles className="h-4 w-4" /> Draft an inspired post
          </Button>
        </Section>
      )}

      {/* Footer */}
      {s.closingQuote && (
        <div className="pt-8 text-center">
          <p className="font-serif italic text-lg text-foreground/70 max-w-lg mx-auto leading-relaxed">
            «{s.closingQuote}»
          </p>
        </div>
      )}
    </div>
  );
}

function Section({
  num,
  title,
  desc,
  children,
}: {
  num: string;
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-baseline gap-3 mb-1">
        <span className="text-[11px] tracking-wider text-muted-foreground">{num}</span>
        <h2 className="font-serif text-2xl">{title}</h2>
      </div>
      {desc && <p className="text-sm text-muted-foreground mb-7 max-w-lg">{desc}</p>}
      {children}
    </section>
  );
}

function StrategyCard({ label, body }: { label: string; body: string }) {
  return (
    <div className="bg-card p-6">
      <span className="block text-[10px] uppercase tracking-wider text-accent mb-2.5">{label}</span>
      <p className="text-sm text-foreground/75 leading-relaxed">{body}</p>
    </div>
  );
}

function SvColumn({
  kind,
  label,
  items,
}: {
  kind: "strength" | "risk";
  label: string;
  items: { title: string; body: string }[];
}) {
  const headCls =
    kind === "strength"
      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
      : "bg-amber-500/10 text-amber-700 dark:text-amber-400";
  return (
    <div className="bg-card p-6">
      <span
        className={`inline-block text-[11px] uppercase tracking-wider px-2.5 py-1 mb-4 ${headCls}`}
      >
        {label}
      </span>
      <div>
        {items.map((it, i) => (
          <div
            key={i}
            className="flex gap-2.5 py-3 border-t border-border first:border-t-0 text-sm text-foreground/75"
          >
            <div>
              <b className="block text-foreground font-semibold text-[13.5px] mb-0.5">{it.title}</b>
              {it.body}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
