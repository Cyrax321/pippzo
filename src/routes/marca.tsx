import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { brandStore, useBrandProfile, useBrandGuideline } from "@/lib/brand-store";
import { generateGuideline, extractFromText } from "@/lib/ai.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Sparkles, Loader2 } from "lucide-react";
import type { BrandProfile } from "@/lib/types";

export const Route = createFileRoute("/marca")({
  head: () => ({
    meta: [
      { title: "Brand · Social Studio" },
      { name: "description", content: "Your brand profile." },
    ],
  }),
  component: MarcaPage,
});

const EMPTY: BrandProfile = {
  name: "",
  website: "",
  socials: "",
  industry: "",
  audience: "",
  productsServices: "",
  toneNotes: "",
};

function MarcaPage() {
  const existing = useBrandProfile();
  const guideline = useBrandGuideline();
  const [profile, setProfile] = useState<BrandProfile>(existing ?? EMPTY);
  const [brandDoc, setBrandDoc] = useState("");
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const gen = useServerFn(generateGuideline);
  const extract = useServerFn(extractFromText);

  useEffect(() => {
    if (existing && profile === EMPTY) setProfile(existing);
  }, [existing, profile]);

  const save = () => {
    if (!profile.name.trim()) {
      toast.error("Give your brand a name.");
      return;
    }
    brandStore.setProfile(profile);
    toast.success("Profile saved.");
  };

  const generate = async () => {
    if (!profile.name.trim()) {
      toast.error("I need at least the name.");
      return;
    }
    setBusy(true);
    brandStore.setProfile(profile);
    try {
      let sourceText = brandDoc.trim() || undefined;
      if (sourceText && sourceText.length > 2000) {
        const { summary } = await extract({ data: { text: sourceText } });
        sourceText = summary;
      }
      const g = await gen({ data: { profile, sourceText } });
      brandStore.setGuideline(g);
      toast.success("Guide created.");
      nav({ to: "/guia" });
    } catch (e) {
      console.error(e);
      toast.error("Could not generate the guide.");
    } finally {
      setBusy(false);
    }
  };

  const set = <K extends keyof BrandProfile>(k: K, v: string) =>
    setProfile((p) => ({ ...p, [k]: v }));

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Brand</p>
      <h1 className="mt-2 font-serif text-4xl">Your brand profile</h1>
      <p className="mt-2 text-muted-foreground">
        The better it knows you, the better it writes for you. Just enough, no endless forms.
      </p>

      <div className="mt-10 grid gap-5">
        <Field label="Name">
          <Input
            value={profile.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Your name or brand"
          />
        </Field>
        <div className="grid sm:grid-cols-2 gap-5">
          <Field label="Website">
            <Input
              value={profile.website}
              onChange={(e) => set("website", e.target.value)}
              placeholder="https://..."
            />
          </Field>
          <Field label="Industry">
            <Input
              value={profile.industry}
              onChange={(e) => set("industry", e.target.value)}
              placeholder="AI advisory, SaaS, fashion..."
            />
          </Field>
        </div>
        <Field label="Social handles">
          <Input
            value={profile.socials}
            onChange={(e) => set("socials", e.target.value)}
            placeholder="@instagram, /linkedin..."
          />
        </Field>
        <Field label="Audience">
          <Textarea
            rows={2}
            value={profile.audience}
            onChange={(e) => set("audience", e.target.value)}
            placeholder="Who follows you and who you want to talk to."
          />
        </Field>
        <Field label="Products or services">
          <Textarea
            rows={2}
            value={profile.productsServices}
            onChange={(e) => set("productsServices", e.target.value)}
            placeholder="What you sell or do."
          />
        </Field>
        <Field label="Tone notes (optional)">
          <Textarea
            rows={2}
            value={profile.toneNotes}
            onChange={(e) => set("toneNotes", e.target.value)}
            placeholder="How you want to sound. What to avoid."
          />
        </Field>

        <div className="rounded-lg border border-border bg-muted/40 p-5">
          <Label className="font-serif text-lg">Existing brand book (optional)</Label>
          <p className="text-sm text-muted-foreground mt-1">
            Paste the contents of your current brand guide here (PDF, doc, whatever you have). The
            AI uses it as a base.
          </p>
          <Textarea
            className="mt-3 min-h-32 font-mono text-xs"
            value={brandDoc}
            onChange={(e) => setBrandDoc(e.target.value)}
            placeholder="Paste brand book text..."
          />
        </div>

        <div className="flex flex-wrap gap-3 pt-2">
          <Button onClick={generate} disabled={busy} size="lg" className="gap-2">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {guideline ? "Regenerate guide" : "Create social media guide"}
          </Button>
          <Button onClick={save} variant="outline" size="lg">
            Save profile
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
