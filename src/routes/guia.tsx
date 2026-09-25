import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { brandStore, useBrandGuideline } from "@/lib/brand-store";
import { extractBrandGuidelineFromPdf } from "@/lib/ai.functions";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, Upload, Plus, X } from "lucide-react";
import type { BrandGuideline, ColorSwatch } from "@/lib/types";

export const Route = createFileRoute("/guia")({
  head: () => ({
    meta: [
      { title: "Guide · Social Studio" },
      { name: "description", content: "Brand guide and visual identity." },
    ],
  }),
  component: GuiaPage,
});

function GuiaPage() {
  const g = useBrandGuideline();
  const extractPdf = useServerFn(extractBrandGuidelineFromPdf);
  const pdfRef = useRef<HTMLInputElement>(null);
  const [extracting, setExtracting] = useState(false);

  if (!g) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-24 text-center">
        <h1 className="font-serif text-4xl">No guide yet</h1>
        <p className="mt-3 text-muted-foreground">
          Create your brand profile and generate the first version.
        </p>
        <Link
          to="/marca"
          className="mt-6 inline-flex rounded-md bg-foreground px-5 py-3 text-sm text-background"
        >
          Go to Brand
        </Link>
      </div>
    );
  }

  const update = <K extends keyof BrandGuideline>(k: K, v: BrandGuideline[K]) => {
    brandStore.setGuideline({ ...g, [k]: v });
  };

  const palette: ColorSwatch[] = g.colorPalette ?? [];
  const setPalette = (p: ColorSwatch[]) => update("colorPalette", p);

  const typography = g.typography ?? {};
  const setTypography = (t: BrandGuideline["typography"]) => update("typography", t);

  const handlePdf = async (file: File) => {
    if (file.type !== "application/pdf") {
      toast.error("Please upload a PDF file.");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast.error("PDF must be under 20 MB.");
      return;
    }
    setExtracting(true);
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = () => reject(new Error("read_failed"));
        r.readAsDataURL(file);
      });
      const extracted = await extractPdf({ data: { dataUrl, fileName: file.name } });
      // Merge — do not overwrite existing non-empty fields silently. Empty extracted
      // strings/arrays get skipped so an incomplete PDF doesn't wipe the guide.
      const merged: BrandGuideline = { ...g };
      const setIf = <K extends keyof BrandGuideline>(k: K, v: BrandGuideline[K]) => {
        const empty = typeof v === "string" ? !v.trim() : Array.isArray(v) ? v.length === 0 : false;
        if (!empty) (merged as any)[k] = v;
      };
      setIf("personality", extracted.personality);
      setIf("toneOfVoice", extracted.toneOfVoice);
      setIf("writingStyle", extracted.writingStyle);
      setIf("vocabularyUse", extracted.vocabularyUse);
      setIf("vocabularyAvoid", extracted.vocabularyAvoid);
      setIf("contentPillars", extracted.contentPillars);
      setIf("audienceProfile", extracted.audienceProfile);
      setIf("recurringThemes", extracted.recurringThemes);
      setIf("preferredCTAs", extracted.preferredCTAs);
      setIf("doExamples", extracted.doExamples);
      setIf("dontExamples", extracted.dontExamples);
      setIf("visualDirection", extracted.visualDirection);
      setIf("hashtagStyle", extracted.hashtagStyle);
      setIf("platformGuidance", extracted.platformGuidance);
      setIf("emotionalTone", extracted.emotionalTone);
      setIf("customInstructions", extracted.customInstructions);
      if (extracted.colorPalette?.length) merged.colorPalette = extracted.colorPalette;
      if (
        extracted.typography &&
        (extracted.typography.headingFont || extracted.typography.bodyFont)
      ) {
        merged.typography = extracted.typography;
      }
      brandStore.setGuideline(merged);
      toast.success("Brand guide extracted from PDF.");
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Extraction failed.");
    } finally {
      setExtracting(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-6 py-12 space-y-10">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Guide</p>
        <h1 className="mt-2 font-serif text-4xl">Social media guide</h1>
        <p className="mt-2 text-muted-foreground">
          Your brand's brain. Edit anything that doesn't fit. Every change applies to everything
          generated from now on.
        </p>
      </div>

      {/* PDF extractor */}
      <section className="rounded-lg border border-dashed border-border p-5 flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex-1">
          <p className="text-sm font-medium">Extract from a brand book PDF</p>
          <p className="text-xs text-muted-foreground mt-1">
            Upload your existing brand guidelines (PDF). We'll pull voice, palette, typography,
            do/don't examples, and content pillars into the fields below without erasing what you
            already have.
          </p>
        </div>
        <div>
          <Button
            variant="outline"
            onClick={() => pdfRef.current?.click()}
            disabled={extracting}
            className="gap-2"
          >
            {extracting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            {extracting ? "Extracting…" : "Upload PDF"}
          </Button>
          <input
            ref={pdfRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handlePdf(f);
              e.target.value = "";
            }}
          />
        </div>
      </section>

      {/* Visual identity */}
      <section className="space-y-6 rounded-lg border border-border p-5">
        <div>
          <h2 className="font-serif text-2xl">Visual identity</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Colors and typography for image generation and manual design.
          </p>
        </div>

        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            Color palette
          </Label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {palette.map((c, i) => (
              <div key={i} className="flex items-center gap-2 border border-border p-2 rounded-md">
                <div
                  className="h-10 w-10 rounded-sm border border-border shrink-0"
                  style={{ background: c.hex || "#eee" }}
                />
                <div className="flex flex-col gap-1 flex-1 min-w-0">
                  <Input
                    value={c.name}
                    onChange={(e) =>
                      setPalette(
                        palette.map((p, j) => (j === i ? { ...p, name: e.target.value } : p)),
                      )
                    }
                    placeholder="Name"
                    className="h-7 text-xs"
                  />
                  <Input
                    value={c.hex}
                    onChange={(e) =>
                      setPalette(
                        palette.map((p, j) => (j === i ? { ...p, hex: e.target.value } : p)),
                      )
                    }
                    placeholder="#0F172A"
                    className="h-7 text-xs font-mono"
                  />
                </div>
                <button
                  onClick={() => setPalette(palette.filter((_, j) => j !== i))}
                  className="text-muted-foreground hover:text-foreground shrink-0"
                  aria-label="Remove color"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <button
              onClick={() => setPalette([...palette, { name: "", hex: "#000000" }])}
              className="border border-dashed border-border rounded-md p-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/50"
            >
              <Plus className="h-3.5 w-3.5" /> Add color
            </button>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Heading font
            </Label>
            <Input
              value={typography.headingFont ?? ""}
              onChange={(e) => setTypography({ ...typography, headingFont: e.target.value })}
              placeholder="e.g. Editorial New"
            />
            <p className="text-lg" style={{ fontFamily: typography.headingFont }}>
              {typography.headingFont || "Preview heading"}
            </p>
          </div>
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Body font
            </Label>
            <Input
              value={typography.bodyFont ?? ""}
              onChange={(e) => setTypography({ ...typography, bodyFont: e.target.value })}
              placeholder="e.g. Inter"
            />
            <p className="text-sm" style={{ fontFamily: typography.bodyFont }}>
              {typography.bodyFont || "Preview body text — quick brown fox."}
            </p>
          </div>
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Mono font
            </Label>
            <Input
              value={typography.monoFont ?? ""}
              onChange={(e) => setTypography({ ...typography, monoFont: e.target.value })}
              placeholder="e.g. JetBrains Mono"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Typography notes
            </Label>
            <Textarea
              rows={2}
              value={typography.notes ?? ""}
              onChange={(e) => setTypography({ ...typography, notes: e.target.value })}
              placeholder="Rules for pairing, sizes, weights…"
            />
          </div>
        </div>
      </section>

      <Section label="Personality">
        <Textarea
          rows={2}
          value={g.personality}
          onChange={(e) => update("personality", e.target.value)}
        />
      </Section>
      <Section label="Tone of voice">
        <Textarea
          rows={3}
          value={g.toneOfVoice}
          onChange={(e) => update("toneOfVoice", e.target.value)}
        />
      </Section>
      <Section label="Writing style">
        <Textarea
          rows={3}
          value={g.writingStyle}
          onChange={(e) => update("writingStyle", e.target.value)}
        />
      </Section>

      <ListEditor
        label="Vocabulary to use"
        items={g.vocabularyUse}
        onChange={(v) => update("vocabularyUse", v)}
      />
      <ListEditor
        label="Vocabulary to avoid"
        items={g.vocabularyAvoid}
        onChange={(v) => update("vocabularyAvoid", v)}
      />
      <ListEditor
        label="Content pillars"
        items={g.contentPillars}
        onChange={(v) => update("contentPillars", v)}
      />
      <ListEditor
        label="Recurring themes"
        items={g.recurringThemes}
        onChange={(v) => update("recurringThemes", v)}
      />
      <ListEditor
        label="Preferred CTAs"
        items={g.preferredCTAs}
        onChange={(v) => update("preferredCTAs", v)}
      />
      <ListEditor
        label="On-brand copy examples"
        items={g.doExamples}
        onChange={(v) => update("doExamples", v)}
      />
      <ListEditor
        label="Copy examples to avoid"
        items={g.dontExamples}
        onChange={(v) => update("dontExamples", v)}
      />

      <Section label="Audience">
        <Textarea
          rows={3}
          value={g.audienceProfile}
          onChange={(e) => update("audienceProfile", e.target.value)}
        />
      </Section>
      <Section label="Emotional tone">
        <Textarea
          rows={2}
          value={g.emotionalTone}
          onChange={(e) => update("emotionalTone", e.target.value)}
        />
      </Section>
      <Section label="Visual direction">
        <Textarea
          rows={3}
          value={g.visualDirection}
          onChange={(e) => update("visualDirection", e.target.value)}
        />
      </Section>
      <Section label="Hashtags">
        <Input value={g.hashtagStyle} onChange={(e) => update("hashtagStyle", e.target.value)} />
      </Section>
      <Section label="Per-platform guidance">
        <Textarea
          rows={3}
          value={g.platformGuidance}
          onChange={(e) => update("platformGuidance", e.target.value)}
        />
      </Section>
      <Section label="Custom instructions">
        <Textarea
          rows={3}
          value={g.customInstructions}
          onChange={(e) => update("customInstructions", e.target.value)}
          placeholder="E.g. Never use emojis. English only. Short sentences."
        />
      </Section>

      <div className="flex justify-end">
        <Button onClick={() => toast.success("Saved.")}>Save changes</Button>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function ListEditor({
  label,
  items,
  onChange,
}: {
  label: string;
  items: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <div className="grid gap-2">
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</Label>
      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={i} className="flex gap-2">
            <Input
              value={it}
              onChange={(e) => {
                const n = [...items];
                n[i] = e.target.value;
                onChange(n);
              }}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onChange(items.filter((_, j) => j !== i))}
            >
              Remove
            </Button>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={() => onChange([...items, ""])}>
          + Add
        </Button>
      </div>
    </div>
  );
}
