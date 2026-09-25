import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  listLlmProviders,
  saveLlmProvider,
  deleteLlmProvider,
  setDefaultLlmProvider,
  testLlmProvider,
  type LlmProviderPublic,
  type LlmProviderKindPublic,
} from "@/lib/llm-providers.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { SectionDisclosure } from "@/components/section-disclosure";
import {
  Loader2,
  Plus,
  Trash2,
  Star,
  Brain,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import { LLM_CATALOG, DEFAULT_MODEL_ID, catalogProvider, modelLabel } from "@/lib/llm-catalog";

const empty = {
  provider: "openai" as LlmProviderKindPublic,
  label: "",
  apiKey: "",
  baseUrl: "",
  defaultModel: DEFAULT_MODEL_ID.openai,
};

export function LlmProvidersSection({ workspaceId }: { workspaceId: string | null }) {
  const list = useServerFn(listLlmProviders);
  const save = useServerFn(saveLlmProvider);
  const remove = useServerFn(deleteLlmProvider);
  const makeDefault = useServerFn(setDefaultLlmProvider);
  const test = useServerFn(testLlmProvider);

  const [providers, setProviders] = useState<LlmProviderPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [form, setForm] = useState(empty);

  const load = useCallback(() => {
    if (!workspaceId) return;
    setLoading(true);
    setLoadError(null);
    list({ data: { workspaceId } })
      .then((r) => setProviders(r.providers))
      .catch((e) => setLoadError(e instanceof Error ? e.message : "Could not load text models."))
      .finally(() => setLoading(false));
  }, [workspaceId, list]);

  useEffect(load, [load]);

  const opt = catalogProvider(form.provider);
  const modelOpt = opt.models.find((m) => m.id === form.defaultModel);
  const incomplete =
    !form.label.trim() ||
    !form.apiKey.trim() ||
    (opt.requiresBaseUrl && !form.baseUrl.trim()) ||
    (opt.freeformModel && !form.defaultModel.trim());

  const onAdd = async () => {
    if (!workspaceId) return;
    setSaving(true);
    try {
      const p = await save({
        data: {
          workspaceId,
          provider: form.provider,
          label: form.label.trim(),
          apiKey: form.apiKey.trim(),
          baseUrl: form.baseUrl.trim().replace(/\/+$/, ""),
          defaultModel: form.defaultModel.trim() || opt.models[0]?.id || "",
        },
      });
      setProviders((cur) => [p, ...cur.map((x) => (p.isDefault ? { ...x, isDefault: false } : x))]);
      setForm(empty);
      toast.success("Text model connected");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const onTest = async (id: string) => {
    setTesting(id);
    try {
      const r = await test({ data: { id } });
      if (r.ok) toast.success("Key works — the model replied.");
      else toast.error(r.error ?? "Test failed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Test failed");
    } finally {
      setTesting(null);
    }
  };

  return (
    <SectionDisclosure
      icon={<Brain className="h-4 w-4" />}
      title={<>Text model (the agent&rsquo;s brain)</>}
      subtitle="Bring your own key"
    >
      <div className="px-5 py-5 space-y-5">
        <p className="text-sm text-muted-foreground">
          Every chat reply, generated post, competitor report and autonomous run uses this model.
          There is no shared fallback account: you pay your provider directly, and nothing leaves
          your own account. Until a model is connected here, the agent will say so rather than
          guess.
        </p>

        {loading ? (
          <p className="text-xs text-muted-foreground inline-flex items-center gap-2">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading
          </p>
        ) : loadError ? (
          <div className="flex items-start justify-between gap-3 text-xs border border-dashed border-destructive/50 px-4 py-3">
            <span className="flex items-start gap-2 text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              Couldn&rsquo;t load text models: {loadError}
            </span>
            <Button variant="ghost" size="sm" className="gap-1.5 shrink-0" onClick={load}>
              <RefreshCw className="h-3.5 w-3.5" /> Retry
            </Button>
          </div>
        ) : providers.length > 0 ? (
          <ul className="divide-y divide-border border border-border">
            {providers.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {p.label}
                    {p.isDefault && (
                      <span className="ml-2 font-mono text-[10px] border border-foreground px-1.5 py-0.5">
                        DEFAULT
                      </span>
                    )}
                  </p>
                  <p className="text-[11px] text-muted-foreground font-mono truncate">
                    {p.provider} · {modelLabel(p.provider, p.defaultModel)}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onTest(p.id)}
                    disabled={testing === p.id}
                    className="gap-1.5"
                  >
                    {testing === p.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    )}
                    Test
                  </Button>
                  {!p.isDefault && workspaceId && (
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Make default"
                      onClick={async () => {
                        await makeDefault({ data: { workspaceId, id: p.id } });
                        setProviders((cur) => cur.map((x) => ({ ...x, isDefault: x.id === p.id })));
                      }}
                    >
                      <Star className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Remove"
                    onClick={async () => {
                      await remove({ data: { id: p.id } });
                      setProviders((cur) => cur.filter((x) => x.id !== p.id));
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground border border-dashed border-border px-4 py-3">
            No text model connected yet. Chat and every autonomous run stay disabled until you add
            one below.
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2 border-t border-border pt-5">
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs">Provider</Label>
            <Select
              value={form.provider}
              onValueChange={(v) => {
                const kind = v as LlmProviderKindPublic;
                setForm((c) => ({
                  ...c,
                  provider: kind,
                  baseUrl: "",
                  defaultModel: DEFAULT_MODEL_ID[kind],
                }));
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LLM_CATALOG.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">{opt.hint}</p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Label</Label>
            <Input
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="My OpenAI account"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">{opt.freeformModel ? "Deployment name" : "Model"}</Label>
            {opt.freeformModel ? (
              <Input
                value={form.defaultModel}
                onChange={(e) => setForm({ ...form, defaultModel: e.target.value })}
                placeholder="gpt-5.4"
                className="font-mono"
              />
            ) : (
              <Select
                value={form.defaultModel}
                onValueChange={(v) => setForm({ ...form, defaultModel: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {opt.models.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <p className="text-[11px] text-muted-foreground">{opt.modelHelp ?? modelOpt?.hint}</p>
          </div>
          {opt.requiresBaseUrl && (
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs">Endpoint</Label>
              <Input
                value={form.baseUrl}
                onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                placeholder={opt.baseUrlPlaceholder}
                className="font-mono text-xs"
              />
              <p className="text-[11px] text-muted-foreground">{opt.baseUrlHelp}</p>
            </div>
          )}
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs">API key</Label>
            <Input
              type="password"
              value={form.apiKey}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
              placeholder="Paste key"
              className="font-mono"
            />
            <p className="text-[11px] text-muted-foreground">{opt.keyHelp}. Encrypted at rest.</p>
          </div>
        </div>

        <Button onClick={onAdd} disabled={saving || !workspaceId || incomplete} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}{" "}
          Connect model
        </Button>
      </div>
    </SectionDisclosure>
  );
}
