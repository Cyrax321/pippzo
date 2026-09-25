import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import {
  bufferGetStatus,
  bufferSaveToken,
  bufferDisconnect,
  bufferSyncMetrics,
  type BufferStatus,
} from "@/lib/buffer.functions";
import {
  listVideoProviders,
  saveVideoProvider,
  deleteVideoProvider,
} from "@/lib/video-providers.functions";
import {
  listImageProviders,
  saveImageProvider,
  deleteImageProvider,
  setDefaultImageProvider,
  testImageProvider,
} from "@/lib/image-providers.functions";
import type {
  VideoProvider,
  VideoProviderKind,
  ImageProvider,
  ImageProviderKind,
} from "@/lib/types";
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
import {
  Loader2,
  CheckCircle2,
  Plug,
  AlertTriangle,
  Trash2,
  Film,
  Plus,
  BarChart3,
  ImageIcon,
  Star,
} from "lucide-react";
import { useWorkspace } from "@/lib/workspace";
import { LlmProvidersSection } from "@/components/llm-providers-section";
import { PlaybooksSection } from "@/components/playbooks-section";
import { ServiceCredentialsSection } from "@/components/service-credentials-section";
import { NotificationsSection } from "@/components/notifications-section";
import { UnipileSection } from "@/components/unipile-section";
import { SectionDisclosure } from "@/components/section-disclosure";

export const Route = createFileRoute("/conexiones")({
  head: () => ({
    meta: [
      { title: "Connections · Social Studio" },
      {
        name: "description",
        content:
          "Connect Buffer, bring your own image and video generation API keys, and other services.",
      },
    ],
  }),
  component: ConexionesPage,
});

const IMAGE_PROVIDER_OPTIONS: {
  value: ImageProviderKind;
  label: string;
  hint: string;
  defaultBase: string;
  defaultModel: string;
  keyHelp: string;
}[] = [
  {
    value: "openai",
    label: "OpenAI (gpt-image-2.5-sunburst) — latest",
    hint: "Uses your OpenAI account: /v1/images/generations, and /v1/images/edits when you pick references. gpt-image-2.5-sunburst is the latest model — change to gpt-image-1 in the model field if you prefer the previous generation.",
    defaultBase: "https://api.openai.com/v1",
    defaultModel: "gpt-image-2.5-sunburst",
    keyHelp: "platform.openai.com/api-keys — key starts with sk-",
  },
  {
    value: "gemini",
    label: "Google Gemini · Nano Banana",
    hint: "Uses your Google AI Studio key: models/{model}:generateContent. Try gemini-3-pro-image for the Pro model.",
    defaultBase: "https://generativelanguage.googleapis.com",
    defaultModel: "gemini-3.1-flash-image",
    keyHelp: "aistudio.google.com/apikey",
  },
  {
    value: "azure",
    label: "Azure OpenAI (image deployment)",
    hint: "Your own Azure image deployment. Set the base URL to the deployment root — the app appends /images/generations?api-version=2024-02-01. Reference images are not supported on this path.",
    defaultBase: "https://<resource>.cognitiveservices.azure.com/openai/deployments/<deployment>",
    defaultModel: "",
    keyHelp: "Azure portal → your OpenAI resource → Keys and Endpoint",
  },
];

const PROVIDER_OPTIONS: {
  value: VideoProviderKind;
  label: string;
  hint: string;
  defaultBase?: string;
  defaultModel?: string;
  disabled?: boolean;
}[] = [
  {
    value: "veo",
    label: "Google Veo 3.1 (Gemini API)",
    hint: "Cinematic text/image-to-video with audio. Gemini API key from AI Studio.",
    defaultBase: "https://generativelanguage.googleapis.com",
    defaultModel: "veo-3.1-generate-preview",
  },
  {
    value: "gemini-omni",
    label: "Gemini Omni Flash (Gemini API)",
    hint: "Google's fast conversational video model (3–10s, 720p). Same Gemini API key as Veo.",
    defaultBase: "https://generativelanguage.googleapis.com",
    defaultModel: "gemini-omni-flash-preview",
  },
  {
    value: "seedance",
    label: "Dreamina Seedance (BytePlus)",
    hint: "Seedance 2.5 / 2.0 / 2.0 mini via BytePlus ModelArk (ai.byteplus.com key). 2.x rejects reference images with real human faces.",
    defaultBase: "https://ark.ap-southeast.bytepluses.com/api/v3",
    defaultModel: "dreamina-seedance-2-5-260628",
  },
  {
    value: "kling",
    label: "Kling 3.0 (Kling AI)",
    hint: "Kling 3.0 / 3.0 Turbo via the official global API. API key from the Kling console (app.klingai.com/global/dev).",
    defaultBase: "https://api-singapore.klingai.com",
    defaultModel: "kling-3.0",
  },
  {
    value: "runway",
    label: "Runway (Gen-4.5 + hosted models)",
    hint: "One dev.runwayml.com key covers Gen-4.5, Gen-4 Turbo plus hosted Seedance 2.5/2.0/mini and Veo 3.1. Models: gen4.5, gen4_turbo, seedance2_5, seedance2, seedance2_mini, veo3.1, veo3.1_fast.",
    defaultBase: "https://api.dev.runwayml.com",
    defaultModel: "gen4.5",
  },
  {
    value: "luma",
    label: "Luma Dream Machine — coming soon",
    hint: "Adapter not shipped yet.",
    defaultBase: "https://api.lumalabs.ai",
    disabled: true,
  },
  {
    value: "custom",
    label: "Custom / self-hosted — coming soon",
    hint: "Adapter not shipped yet.",
    defaultBase: "",
    disabled: true,
  },
];

function ConexionesPage() {
  const { activeWorkspaceId } = useWorkspace();
  const getStatus = useServerFn(bufferGetStatus);
  const saveToken = useServerFn(bufferSaveToken);
  const disconnect = useServerFn(bufferDisconnect);
  const syncMetrics = useServerFn(bufferSyncMetrics);
  const listProviders = useServerFn(listVideoProviders);
  const addProvider = useServerFn(saveVideoProvider);
  const removeProvider = useServerFn(deleteVideoProvider);

  const [status, setStatus] = useState<BufferStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const onSyncMetrics = async () => {
    if (!activeWorkspaceId) return;
    setSyncing(true);
    try {
      const res = await syncMetrics({ data: { workspaceId: activeWorkspaceId } });
      toast.success(
        `Synced performance for ${res.upserted} published post${res.upserted === 1 ? "" : "s"}.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not sync performance from Buffer.");
    } finally {
      setSyncing(false);
    }
  };

  const [providers, setProviders] = useState<VideoProvider[]>([]);
  const [pLoading, setPLoading] = useState(false);
  const [newP, setNewP] = useState<{
    provider: VideoProviderKind;
    label: string;
    apiKey: string;
    baseUrl: string;
    defaultModel: string;
  }>({
    provider: "veo",
    label: "",
    apiKey: "",
    baseUrl: PROVIDER_OPTIONS[0].defaultBase ?? "",
    defaultModel: "",
  });
  const [pSaving, setPSaving] = useState(false);

  // Image providers (BYO keys)
  const listImgProviders = useServerFn(listImageProviders);
  const addImgProvider = useServerFn(saveImageProvider);
  const removeImgProvider = useServerFn(deleteImageProvider);
  const makeImgDefault = useServerFn(setDefaultImageProvider);
  const testImgProvider = useServerFn(testImageProvider);
  const [imgProviders, setImgProviders] = useState<ImageProvider[]>([]);
  const [imgLoading, setImgLoading] = useState(false);
  const [imgSaving, setImgSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [newI, setNewI] = useState<{
    provider: ImageProviderKind;
    label: string;
    apiKey: string;
    baseUrl: string;
    defaultModel: string;
  }>({
    provider: "openai",
    label: "",
    apiKey: "",
    baseUrl: IMAGE_PROVIDER_OPTIONS[0].defaultBase,
    defaultModel: IMAGE_PROVIDER_OPTIONS[0].defaultModel,
  });

  const refreshImgProviders = async () => {
    if (!activeWorkspaceId) return;
    setImgLoading(true);
    try {
      const { providers } = await listImgProviders({ data: { workspaceId: activeWorkspaceId } });
      setImgProviders(providers);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load image providers");
    } finally {
      setImgLoading(false);
    }
  };

  const onAddImgProvider = async () => {
    if (!activeWorkspaceId) return;
    if (!newI.label.trim() || !newI.apiKey.trim()) {
      toast.error("Label and API key are required.");
      return;
    }
    setImgSaving(true);
    try {
      await addImgProvider({
        data: {
          workspaceId: activeWorkspaceId,
          provider: newI.provider,
          label: newI.label.trim(),
          apiKey: newI.apiKey.trim(),
          baseUrl: newI.baseUrl.trim() || undefined,
          defaultModel: newI.defaultModel.trim() || undefined,
        },
      });
      const opt = IMAGE_PROVIDER_OPTIONS[0];
      setNewI({
        provider: "openai",
        label: "",
        apiKey: "",
        baseUrl: opt.defaultBase,
        defaultModel: opt.defaultModel,
      });
      await refreshImgProviders();
      toast.success("Image provider connected. Generations now use your key.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save provider");
    } finally {
      setImgSaving(false);
    }
  };

  const onRemoveImgProvider = async (id: string) => {
    if (!confirm("Remove this image provider connection?")) return;
    try {
      await removeImgProvider({ data: { id } });
      await refreshImgProviders();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove");
    }
  };

  const onMakeDefault = async (id: string) => {
    if (!activeWorkspaceId) return;
    try {
      await makeImgDefault({ data: { workspaceId: activeWorkspaceId, id } });
      await refreshImgProviders();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not set default");
    }
  };

  const onTestImgProvider = async (id: string) => {
    setTestingId(id);
    try {
      const res = await testImgProvider({ data: { id } });
      if (res.ok) toast.success("Key works — test image generated.");
      else toast.error(res.error ?? "Test failed.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Test failed");
    } finally {
      setTestingId(null);
    }
  };

  const refresh = async () => {
    if (!activeWorkspaceId) return;
    setLoading(true);
    try {
      setStatus(await getStatus({ data: { workspaceId: activeWorkspaceId } }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error querying Buffer");
      setStatus({
        connected: false,
        channels: [],
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setLoading(false);
    }
  };
  const refreshProviders = async () => {
    if (!activeWorkspaceId) return;
    setPLoading(true);
    try {
      const { providers } = await listProviders({ data: { workspaceId: activeWorkspaceId } });
      setProviders(providers);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load video providers");
    } finally {
      setPLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    void refreshProviders();
    void refreshImgProviders(); /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [activeWorkspaceId]);

  const onSave = async () => {
    if (!activeWorkspaceId) return;
    const t = token.trim();
    if (t.length < 10) {
      toast.error("Paste a valid Buffer access token.");
      return;
    }
    setSaving(true);
    try {
      const s = await saveToken({ data: { workspaceId: activeWorkspaceId, accessToken: t } });
      setStatus(s);
      setToken("");
      toast.success(
        `Connected · ${s.channels.length} channel${s.channels.length === 1 ? "" : "s"} detected`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save token");
    } finally {
      setSaving(false);
    }
  };

  const onDisconnect = async () => {
    if (!activeWorkspaceId) return;
    if (!confirm("Disconnect Buffer from this workspace?")) return;
    try {
      await disconnect({ data: { workspaceId: activeWorkspaceId } });
      setStatus({ connected: false, channels: [] });
      toast.success("Disconnected from Buffer");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not disconnect");
    }
  };

  const onAddProvider = async () => {
    if (!activeWorkspaceId) return;
    if (!newP.label.trim() || !newP.apiKey.trim()) {
      toast.error("Label and API key are required.");
      return;
    }
    setPSaving(true);
    try {
      const p = await addProvider({
        data: {
          workspaceId: activeWorkspaceId,
          provider: newP.provider,
          label: newP.label.trim(),
          apiKey: newP.apiKey.trim(),
          baseUrl: newP.baseUrl.trim() || undefined,
          defaultModel: newP.defaultModel.trim() || undefined,
        },
      });
      setProviders((cur) => [p, ...cur]);
      setNewP({
        provider: "veo",
        label: "",
        apiKey: "",
        baseUrl: PROVIDER_OPTIONS[0].defaultBase ?? "",
        defaultModel: "",
      });
      toast.success(`${p.label} connected.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save provider");
    } finally {
      setPSaving(false);
    }
  };

  const onRemoveProvider = async (id: string) => {
    if (!confirm("Remove this video provider connection?")) return;
    try {
      await removeProvider({ data: { id } });
      setProviders((cur) => cur.filter((p) => p.id !== id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove");
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-6 py-10 space-y-4">
      <header className="space-y-2">
        <p className="label-eyebrow">08 · Connections</p>
        <h1 className="font-serif text-4xl">Publish for real</h1>
        <p className="text-sm text-muted-foreground max-w-xl">
          Connect Buffer to publish to real channels. Connect video generation providers to make
          on-brand short videos.
        </p>
      </header>

      <LlmProvidersSection workspaceId={activeWorkspaceId} />

      <ServiceCredentialsSection workspaceId={activeWorkspaceId} />

      <UnipileSection workspaceId={activeWorkspaceId} />

      <NotificationsSection workspaceId={activeWorkspaceId} />

      <PlaybooksSection workspaceId={activeWorkspaceId} />

      {/* Buffer */}
      <SectionDisclosure
        icon={<Plug className="h-4 w-4" />}
        title="Buffer"
        subtitle="buffer.com"
        badge={
          loading ? (
            <span className="font-mono text-[10px] tabular-nums border border-border text-muted-foreground px-2 py-1 inline-flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" /> CHECKING
            </span>
          ) : status?.connected ? (
            <span className="inline-flex items-center gap-1.5 font-mono text-[10px] tabular-nums border border-foreground px-2 py-1">
              <CheckCircle2 className="h-3 w-3" /> CONNECTED
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 font-mono text-[10px] tabular-nums border border-border text-muted-foreground px-2 py-1">
              <AlertTriangle className="h-3 w-3" /> NOT CONNECTED
            </span>
          )
        }
      >
        {!loading && !status?.connected && (
          <div className="px-5 py-5 space-y-4">
            <div className="space-y-2 text-sm">
              <p className="font-medium">How to get your Buffer access token</p>
              <ol className="list-decimal ml-5 space-y-1 text-muted-foreground text-xs">
                <li>
                  Open{" "}
                  <a
                    href="https://publish.buffer.com/developers/apps"
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    publish.buffer.com/developers/apps
                  </a>{" "}
                  and sign in.
                </li>
                <li>
                  Create an application (any name; callback URL can be{" "}
                  <code className="font-mono">http://localhost</code>).
                </li>
                <li>
                  Copy the <strong>Access Token</strong> shown for your app.
                </li>
                <li>
                  Paste it below. We store it encrypted at rest and only use it to publish on your
                  behalf.
                </li>
              </ol>
            </div>
            <div className="space-y-2">
              <Label
                htmlFor="buffer-token"
                className="text-xs uppercase tracking-wider text-muted-foreground"
              >
                Access token
              </Label>
              <Input
                id="buffer-token"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="1/abcdef012345…"
                className="font-mono"
              />
            </div>
            {status?.error && (
              <pre className="font-mono text-[11px] bg-muted/40 border border-border p-3 overflow-auto whitespace-pre-wrap">
                {status.error}
              </pre>
            )}
            <Button onClick={onSave} disabled={saving || !token.trim()} className="rounded-none">
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Connect Buffer
            </Button>
          </div>
        )}

        {!loading && status?.connected && (
          <div className="px-5 py-5 space-y-5">
            <div className="grid sm:grid-cols-3 gap-4 text-sm">
              <div>
                <p className="label-eyebrow !text-[0.625rem]">Organization</p>
                <p className="mt-1">{status.organization?.name}</p>
              </div>
              <div>
                <p className="label-eyebrow !text-[0.625rem]">Account</p>
                <p className="mt-1 truncate">{status.account?.email}</p>
              </div>
              <div>
                <p className="label-eyebrow !text-[0.625rem]">Channels</p>
                <p className="mt-1 tabular-nums">{status.channels.length}</p>
              </div>
            </div>
            <div className="border-t border-border pt-4">
              <p className="label-eyebrow !text-[0.625rem] mb-3">Detected channels</p>
              {status.channels.length === 0 ? (
                <div className="space-y-3 border border-dashed border-border p-4">
                  <p className="text-sm">
                    Your Buffer account is connected, but no social channels are linked yet.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button asChild className="rounded-none">
                      <a
                        href="https://publish.buffer.com/channels"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open Buffer to connect a channel
                      </a>
                    </Button>
                    <Button
                      variant="outline"
                      onClick={refresh}
                      disabled={loading}
                      className="rounded-none"
                    >
                      {loading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "I've connected it — refresh"
                      )}
                    </Button>
                  </div>
                </div>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {status.channels.map((c) => (
                    <li key={c.id} className="flex items-baseline gap-3">
                      <span className="font-mono text-[10px] tabular-nums uppercase text-muted-foreground w-20 shrink-0">
                        {c.service}
                      </span>
                      <span className="flex-1 truncate">{c.name}</span>
                      <span className="font-mono text-[10px] tabular-nums text-muted-foreground truncate max-w-[180px]">
                        {c.id}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex flex-wrap gap-2 pt-2">
              <Button
                variant="outline"
                onClick={refresh}
                disabled={loading}
                className="rounded-none"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Refresh channels"}
              </Button>
              <Button
                variant="outline"
                onClick={onSyncMetrics}
                disabled={syncing}
                className="rounded-none gap-2"
              >
                {syncing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <BarChart3 className="h-4 w-4" />
                )}{" "}
                Sync performance
              </Button>
              <Button
                variant="outline"
                onClick={onDisconnect}
                className="rounded-none gap-2 text-destructive"
              >
                <Trash2 className="h-4 w-4" /> Disconnect
              </Button>
              <Link
                to="/chat"
                className="text-xs text-muted-foreground underline self-center ml-auto"
              >
                Try scheduling from Chat →
              </Link>
            </div>
          </div>
        )}
      </SectionDisclosure>

      {/* Image providers (BYO keys) */}
      <SectionDisclosure
        icon={<ImageIcon className="h-4 w-4" />}
        title="Image generation"
        subtitle="Bring your own key"
        badge={
          <span className="font-mono text-[10px] tabular-nums border border-border text-muted-foreground px-2 py-1">
            {imgProviders.length} CONNECTED
          </span>
        }
      >
        <div className="px-5 py-5 space-y-5">
          <p className="text-sm text-muted-foreground">
            Add your own OpenAI, Google Gemini (Nano Banana) or Azure OpenAI key. Every image — in
            Chat, Create and Library — is generated with your key and billed directly by your
            provider. Until one is connected, image generation is unavailable rather than falling
            back to someone else&rsquo;s account.
          </p>

          {imgLoading ? (
            <div className="text-xs text-muted-foreground inline-flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading…
            </div>
          ) : (
            imgProviders.length > 0 && (
              <ul className="text-sm border border-border divide-y divide-border">
                {imgProviders.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 px-3 py-2">
                    <span className="font-mono text-[10px] tabular-nums uppercase text-muted-foreground w-16 shrink-0">
                      {p.provider}
                    </span>
                    <span className="flex-1 truncate">{p.label}</span>
                    <span className="font-mono text-[10px] tabular-nums text-muted-foreground truncate max-w-[200px]">
                      {p.defaultModel ?? "—"}
                    </span>
                    {p.isDefault ? (
                      <span className="font-mono text-[10px] tabular-nums border border-foreground px-1.5 py-0.5 shrink-0">
                        DEFAULT
                      </span>
                    ) : (
                      <button
                        onClick={() => onMakeDefault(p.id)}
                        className="text-muted-foreground hover:text-foreground shrink-0"
                        aria-label="Make default"
                        title="Make default"
                      >
                        <Star className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => onTestImgProvider(p.id)}
                      disabled={testingId === p.id}
                      className="font-mono text-[10px] uppercase text-muted-foreground hover:text-foreground shrink-0"
                    >
                      {testingId === p.id ? "TESTING…" : "TEST"}
                    </button>
                    <button
                      onClick={() => onRemoveImgProvider(p.id)}
                      className="text-muted-foreground hover:text-destructive shrink-0"
                      aria-label="Remove"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )
          )}

          <div className="border border-dashed border-border p-4 space-y-3">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Add a provider</p>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Provider</Label>
                <Select
                  value={newI.provider}
                  onValueChange={(v) => {
                    const opt = IMAGE_PROVIDER_OPTIONS.find((o) => o.value === v)!;
                    setNewI((cur) => ({
                      ...cur,
                      provider: v as ImageProviderKind,
                      baseUrl: opt.defaultBase,
                      defaultModel: opt.defaultModel,
                    }));
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {IMAGE_PROVIDER_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  {IMAGE_PROVIDER_OPTIONS.find((o) => o.value === newI.provider)?.hint}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Label</Label>
                <Input
                  value={newI.label}
                  onChange={(e) => setNewI({ ...newI, label: e.target.value })}
                  placeholder="My OpenAI account"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-xs">API key</Label>
                <Input
                  type="password"
                  value={newI.apiKey}
                  onChange={(e) => setNewI({ ...newI, apiKey: e.target.value })}
                  placeholder="Paste key"
                  className="font-mono"
                />
                <p className="text-[11px] text-muted-foreground">
                  {IMAGE_PROVIDER_OPTIONS.find((o) => o.value === newI.provider)?.keyHelp}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Base URL (optional)</Label>
                <Input
                  value={newI.baseUrl}
                  onChange={(e) => setNewI({ ...newI, baseUrl: e.target.value })}
                  placeholder="https://api.openai.com/v1"
                  className="font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Model (optional)</Label>
                <Input
                  value={newI.defaultModel}
                  onChange={(e) => setNewI({ ...newI, defaultModel: e.target.value })}
                  placeholder="gpt-image-1"
                  className="font-mono"
                />
              </div>
            </div>
            <Button
              onClick={onAddImgProvider}
              disabled={imgSaving || !newI.label.trim() || !newI.apiKey.trim()}
              className="gap-2"
            >
              {imgSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}{" "}
              Add provider
            </Button>
          </div>
        </div>
      </SectionDisclosure>

      {/* Video providers */}
      <SectionDisclosure
        icon={<Film className="h-4 w-4" />}
        title="Video generation"
        subtitle="Bring your own key"
        badge={
          <span className="font-mono text-[10px] tabular-nums border border-border text-muted-foreground px-2 py-1">
            {providers.length} CONNECTED
          </span>
        }
      >
        <div className="px-5 py-5 space-y-5">
          <p className="text-sm text-muted-foreground">
            Add your own API key for the video service you prefer. Nothing is hard-coded — you pay
            your provider directly. Generated clips will drop straight into your Library.
          </p>

          {pLoading ? (
            <div className="text-xs text-muted-foreground inline-flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading…
            </div>
          ) : (
            providers.length > 0 && (
              <ul className="space-y-1.5 text-sm border border-border divide-y divide-border">
                {providers.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 px-3 py-2">
                    <span className="font-mono text-[10px] tabular-nums uppercase text-muted-foreground w-16 shrink-0">
                      {p.provider}
                    </span>
                    <span className="flex-1 truncate">{p.label}</span>
                    <span className="font-mono text-[10px] tabular-nums text-muted-foreground truncate max-w-[220px]">
                      {p.defaultModel ?? "—"}
                    </span>
                    <button
                      onClick={() => onRemoveProvider(p.id)}
                      className="text-muted-foreground hover:text-destructive shrink-0"
                      aria-label="Remove"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )
          )}

          <div className="border border-dashed border-border p-4 space-y-3">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Add a provider</p>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Provider</Label>
                <Select
                  value={newP.provider}
                  onValueChange={(v) => {
                    const opt = PROVIDER_OPTIONS.find((o) => o.value === v)!;
                    // Switching kind pre-fills that provider's base URL and model
                    // so a pasted key is all that's actually required.
                    setNewP((cur) => ({
                      ...cur,
                      provider: v as VideoProviderKind,
                      baseUrl: opt.defaultBase ?? "",
                      defaultModel: opt.defaultModel ?? "",
                    }));
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDER_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value} disabled={o.disabled}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  {PROVIDER_OPTIONS.find((o) => o.value === newP.provider)?.hint}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Label</Label>
                <Input
                  value={newP.label}
                  onChange={(e) => setNewP({ ...newP, label: e.target.value })}
                  placeholder="My Runway account"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-xs">API key</Label>
                <Input
                  type="password"
                  value={newP.apiKey}
                  onChange={(e) => setNewP({ ...newP, apiKey: e.target.value })}
                  placeholder="Paste key"
                  className="font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Base URL (optional)</Label>
                <Input
                  value={newP.baseUrl}
                  onChange={(e) => setNewP({ ...newP, baseUrl: e.target.value })}
                  placeholder="https://api.example.com"
                  className="font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Default model (optional)</Label>
                <Input
                  value={newP.defaultModel}
                  onChange={(e) => setNewP({ ...newP, defaultModel: e.target.value })}
                  placeholder={
                    PROVIDER_OPTIONS.find((o) => o.value === newP.provider)?.defaultModel ??
                    "model id"
                  }
                  className="font-mono"
                />
              </div>
            </div>
            <Button
              onClick={onAddProvider}
              disabled={pSaving || !newP.label.trim() || !newP.apiKey.trim()}
              className="gap-2"
            >
              {pSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}{" "}
              Add provider
            </Button>
            <p className="text-[11px] text-muted-foreground">
              Google Veo is available now in the{" "}
              <Link to="/library" className="underline">
                Library
              </Link>
              . Leave the model blank to use Google's current Veo model.
            </p>
          </div>
        </div>
      </SectionDisclosure>
    </div>
  );
}
