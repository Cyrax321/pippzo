import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  getSocialAccountsStatusFn,
  saveDirectSocialTokenFn,
  disconnectDirectSocialFn,
  saveCustomSocialProviderFn,
  deleteCustomSocialProviderFn,
} from "@/lib/social/social-publisher.functions";
import type {
  SocialStatusMap,
} from "@/lib/social/social-types";
import { POPULAR_PRESETS } from "@/lib/social/social-types";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Loader2,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  Share2,
  ShieldCheck,
  RefreshCw,
  Plus,
  BookOpen,
  HelpCircle,
  Copy,
  ChevronDown,
  ChevronUp,
  Info,
  Globe,
  SlidersHorizontal,
} from "lucide-react";

export function SocialConnectionsSection({ workspaceId }: { workspaceId: string | null }) {
  const getStatus = useServerFn(getSocialAccountsStatusFn);
  const saveToken = useServerFn(saveDirectSocialTokenFn);
  const disconnect = useServerFn(disconnectDirectSocialFn);
  const saveCustom = useServerFn(saveCustomSocialProviderFn);
  const deleteCustom = useServerFn(deleteCustomSocialProviderFn);

  const [loading, setLoading] = useState(true);
  const [statusMap, setStatusMap] = useState<SocialStatusMap | null>(null);

  // Standard connect dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [targetPlatform, setTargetPlatform] = useState<string | null>(null);
  const [tokenInput, setTokenInput] = useState("");
  const [labelInput, setLabelInput] = useState("");
  const [busy, setBusy] = useState(false);

  // Custom provider dialog
  const [customDialogOpen, setCustomDialogOpen] = useState(false);
  const [customPreset, setCustomPreset] = useState<string>("threads");
  const [customLabel, setCustomLabel] = useState("");
  const [customKey, setCustomKey] = useState("");
  const [customApiKey, setCustomApiKey] = useState("");
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [customCharLimit, setCustomCharLimit] = useState("5000");
  const [customIcon, setCustomIcon] = useState("🌐");

  // Expanded inline guide platform
  const [expandedGuidePlatform, setExpandedGuidePlatform] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!workspaceId) return;
    setLoading(true);
    getStatus({ data: { workspaceId } })
      .then((st) => setStatusMap(st))
      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed to load social accounts status"))
      .finally(() => setLoading(false));
  }, [workspaceId, getStatus]);

  useEffect(load, [load]);

  const openConnectDialog = (p: string) => {
    setTargetPlatform(p);
    setTokenInput("");
    setLabelInput("");
    setDialogOpen(true);
  };

  const openAddCustomDialog = () => {
    setCustomPreset("threads");
    const p = POPULAR_PRESETS.threads;
    setCustomLabel(p?.label || "");
    setCustomKey("threads");
    setCustomApiKey("");
    setCustomBaseUrl("");
    setCustomCharLimit(String(p?.charLimit || 500));
    setCustomIcon(p?.icon || "🧵");
    setCustomDialogOpen(true);
  };

  const onPresetChange = (val: string) => {
    setCustomPreset(val);
    const p = POPULAR_PRESETS[val];
    if (p) {
      setCustomLabel(p.label);
      setCustomKey(p.key);
      setCustomCharLimit(String(p.charLimit));
      setCustomIcon(p.icon);
    } else {
      setCustomLabel("My Custom Provider");
      setCustomKey(`custom_${Date.now()}`);
      setCustomCharLimit("5000");
      setCustomIcon("🌐");
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`Copied ${label} to clipboard!`);
  };

  const handleSaveStandard = async () => {
    if (!workspaceId || !targetPlatform) return;
    if (targetPlatform === "x") {
      setDialogOpen(false);
      return;
    }

    if (!tokenInput.trim()) {
      toast.error("Please enter a valid Access Token or API Key.");
      return;
    }

    setBusy(true);
    try {
      await saveToken({
        data: {
          workspaceId,
          service: targetPlatform,
          token: tokenInput.trim(),
          label: labelInput.trim() || undefined,
        },
      });
      toast.success(`${POPULAR_PRESETS[targetPlatform]?.label || targetPlatform} connected successfully!`);
      setDialogOpen(false);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to connect platform");
    } finally {
      setBusy(false);
    }
  };

  const handleSaveCustom = async () => {
    if (!workspaceId) return;
    if (!customKey.trim() || !customLabel.trim() || !customApiKey.trim()) {
      toast.error("Please fill in Provider Name, Platform Key, and API Key / Webhook URL.");
      return;
    }

    setBusy(true);
    try {
      await saveCustom({
        data: {
          workspaceId,
          key: customKey.trim().toLowerCase(),
          label: customLabel.trim(),
          apiKey: customApiKey.trim(),
          baseUrl: customBaseUrl.trim() || undefined,
          charLimit: Number(customCharLimit) || 5000,
          icon: customIcon.trim() || "🌐",
        },
      });
      toast.success(`Custom provider "${customLabel}" saved and connected!`);
      setCustomDialogOpen(false);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save custom provider");
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async (p: string) => {
    if (!workspaceId) return;
    if (p === "x") {
      toast.info("Manage X disconnection directly in the X (Twitter) section below.");
      return;
    }

    const label = statusMap?.[p]?.label || p;
    if (!confirm(`Disconnect ${label}?`)) return;

    setBusy(true);
    try {
      if (statusMap?.[p]?.isCustom) {
        await deleteCustom({ data: { workspaceId, key: p } });
      } else {
        await disconnect({ data: { workspaceId, service: p } });
      }
      toast.success(`${label} disconnected.`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to disconnect platform");
    } finally {
      setBusy(false);
    }
  };

  const standardPlatforms = ["x", "linkedin", "instagram", "facebook"];
  const customPlatforms = statusMap
    ? Object.keys(statusMap).filter((k) => !standardPlatforms.includes(k) && statusMap[k].connected)
    : [];

  const totalConnected = statusMap
    ? Object.values(statusMap).filter((s) => s.connected).length
    : 0;

  const targetConfig = targetPlatform ? POPULAR_PRESETS[targetPlatform] : null;

  return (
    <>
      <SectionDisclosure
        icon={<Share2 className="h-4 w-4" />}
        title="Social Media Accounts & Custom API Providers"
        subtitle="Connect X, LinkedIn, Instagram, Facebook, Threads, Bluesky, TikTok, Webhooks & any custom API"
        badge={
          loading ? (
            <span className="font-mono text-[10px] tabular-nums border border-border text-muted-foreground px-2 py-1 inline-flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" /> CHECKING
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 font-mono text-[10px] tabular-nums border border-foreground px-2 py-1">
              <CheckCircle2 className="h-3 w-3 text-emerald-500" /> {totalConnected} ACTIVE CONNECTED
            </span>
          )
        }
      >
        <div className="px-5 py-5 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground max-w-xl">
              Authenticate your social accounts and custom API providers once. When you compose a post in <strong>/crear</strong>,
              you can publish or schedule across all connected platforms simultaneously with a single click.
            </p>
            <div className="flex items-center gap-2 self-start sm:self-auto">
              <Button
                variant="default"
                size="sm"
                onClick={openAddCustomDialog}
                className="gap-1.5 text-xs shadow-sm bg-primary text-primary-foreground font-semibold"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Custom Provider
              </Button>
              <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5 text-xs">
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </div>

          {/* Standard Platforms Section */}
          <div className="space-y-2">
            <Label className="text-xs uppercase font-mono tracking-wider text-muted-foreground">
              Core Social Networks
            </Label>
            <div className="grid gap-3 sm:grid-cols-2">
              {standardPlatforms.map((p) => {
                const cfg = POPULAR_PRESETS[p];
                const acc = statusMap?.[p];
                const isConnected = acc?.connected;

                return (
                  <div
                    key={p}
                    className="border border-border p-4 rounded-lg bg-card/50 flex flex-col justify-between space-y-3"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2.5">
                        <div
                          className={`w-8 h-8 rounded-md flex items-center justify-center font-bold text-sm ${cfg.color}`}
                        >
                          {cfg.icon}
                        </div>
                        <div>
                          <h4 className="font-medium text-sm leading-tight">{cfg.label}</h4>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            {isConnected ? (
                              <span className="text-emerald-500 font-medium">
                                Connected {acc?.source === "buffer" ? "(via Buffer)" : "(Direct)"}
                              </span>
                            ) : (
                              "Not connected"
                            )}
                          </p>
                        </div>
                      </div>
                      {isConnected ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-muted-foreground shrink-0" />
                      )}
                    </div>

                    {isConnected && (
                      <div className="text-xs text-muted-foreground bg-muted/40 p-2 rounded">
                        <p className="truncate font-mono">
                          Account: <strong className="text-foreground">{acc?.username || acc?.name || "Connected"}</strong>
                        </p>
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-1">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedGuidePlatform((cur) => (cur === p ? null : p))
                        }
                        className="text-[11px] text-primary hover:underline inline-flex items-center gap-1 font-medium"
                      >
                        <HelpCircle className="h-3 w-3" />
                        How to get key?
                      </button>

                      <div className="flex items-center gap-2">
                        {isConnected ? (
                          acc?.source === "direct" && p !== "x" ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDisconnect(p)}
                              className="text-destructive hover:text-destructive h-7 px-2 text-xs gap-1"
                            >
                              <Trash2 className="h-3 w-3" /> Disconnect
                            </Button>
                          ) : (
                            <span className="text-[11px] text-muted-foreground font-medium">Ready</span>
                          )
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openConnectDialog(p)}
                            className="h-7 px-2.5 text-xs gap-1"
                          >
                            <Plus className="h-3 w-3" /> Connect
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Custom & Extra Connected Providers Section */}
          {customPlatforms.length > 0 && (
            <div className="space-y-2 pt-2">
              <Label className="text-xs uppercase font-mono tracking-wider text-muted-foreground">
                Custom API Providers &amp; Webhooks ({customPlatforms.length})
              </Label>
              <div className="grid gap-3 sm:grid-cols-2">
                {customPlatforms.map((p) => {
                  const acc = statusMap![p];
                  return (
                    <div
                      key={p}
                      className="border border-border p-3.5 rounded-lg bg-card/60 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center font-bold text-base shrink-0">
                          {acc.icon || "🌐"}
                        </div>
                        <div className="min-w-0">
                          <h4 className="font-semibold text-xs truncate leading-tight text-foreground">
                            {acc.label}
                          </h4>
                          <p className="text-[10px] text-emerald-500 font-mono mt-0.5 truncate">
                            Active · Limit: {acc.charLimit.toLocaleString()} chars
                          </p>
                        </div>
                      </div>

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDisconnect(p)}
                        className="text-destructive hover:text-destructive h-7 px-2 text-xs gap-1 shrink-0"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Step-by-Step API Key Guides for All Platforms */}
          <div className="border border-border rounded-lg p-4 bg-muted/20 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-primary" />
                <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground">
                  Interactive API Key &amp; Token Setup Guides
                </h4>
              </div>
              <span className="text-[11px] text-muted-foreground">
                Select any platform for step-by-step instructions
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {Object.keys(POPULAR_PRESETS).map((p) => {
                const cfg = POPULAR_PRESETS[p];
                const isActive = expandedGuidePlatform === p;
                return (
                  <button
                    key={p}
                    onClick={() => setExpandedGuidePlatform(isActive ? null : p)}
                    className={`text-xs px-2.5 py-1 rounded border transition-colors flex items-center gap-1.5 ${
                      isActive
                        ? "bg-foreground text-background font-semibold border-foreground"
                        : "bg-card border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <span>{cfg.icon}</span>
                    <span>{cfg.label}</span>
                    {isActive ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </button>
                );
              })}
              <button
                onClick={() =>
                  setExpandedGuidePlatform(expandedGuidePlatform === "buffer" ? null : "buffer")
                }
                className={`text-xs px-2.5 py-1 rounded border transition-colors flex items-center gap-1.5 ${
                  expandedGuidePlatform === "buffer"
                    ? "bg-foreground text-background font-semibold border-foreground"
                    : "bg-card border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                <span>⚡</span>
                <span>Buffer (Universal Connector)</span>
                {expandedGuidePlatform === "buffer" ? (
                  <ChevronUp className="h-3 w-3" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                )}
              </button>
            </div>

            {/* Expanded Guide Display */}
            {expandedGuidePlatform && expandedGuidePlatform !== "buffer" && (
              <div className="border border-border/80 p-3.5 rounded-lg bg-card text-xs space-y-3 animate-in fade-in-50">
                <div className="flex items-center justify-between border-b border-border pb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">
                      {POPULAR_PRESETS[expandedGuidePlatform]?.label || expandedGuidePlatform} Setup Guide
                    </span>
                  </div>
                  {POPULAR_PRESETS[expandedGuidePlatform]?.guide?.portalUrl &&
                    POPULAR_PRESETS[expandedGuidePlatform]?.guide?.portalUrl !== "#" && (
                      <a
                        href={POPULAR_PRESETS[expandedGuidePlatform].guide!.portalUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary underline inline-flex items-center gap-1 font-medium hover:text-primary/80"
                      >
                        Open {POPULAR_PRESETS[expandedGuidePlatform].guide!.portalName}{" "}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                </div>

                <ol className="list-decimal ml-4 space-y-1.5 text-muted-foreground">
                  {POPULAR_PRESETS[expandedGuidePlatform]?.guide?.steps.map((st, idx) => (
                    <li key={idx} className="leading-relaxed">
                      {st}
                    </li>
                  ))}
                </ol>

                {POPULAR_PRESETS[expandedGuidePlatform]?.guide?.requiredScopes && (
                  <div className="space-y-1 pt-1">
                    <span className="font-medium text-foreground block text-[11px] uppercase tracking-wider">
                      Required Scopes / Permissions:
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {POPULAR_PRESETS[expandedGuidePlatform].guide!.requiredScopes!.map((sc) => (
                        <button
                          key={sc}
                          onClick={() => copyToClipboard(sc, sc)}
                          className="font-mono text-[10px] bg-muted px-2 py-0.5 rounded border border-border inline-flex items-center gap-1 hover:bg-muted/80"
                          title="Click to copy scope"
                        >
                          {sc} <Copy className="h-2.5 w-2.5 opacity-60" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {POPULAR_PRESETS[expandedGuidePlatform]?.guide?.tip && (
                  <div className="flex items-start gap-2 bg-muted/40 p-2.5 rounded border border-border/60 text-[11px] text-muted-foreground">
                    <Info className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
                    <span>
                      <strong className="text-foreground">Pro Tip: </strong>
                      {POPULAR_PRESETS[expandedGuidePlatform].guide!.tip}
                    </span>
                  </div>
                )}
              </div>
            )}

            {expandedGuidePlatform === "buffer" && (
              <div className="border border-border/80 p-3.5 rounded-lg bg-card text-xs space-y-3 animate-in fade-in-50">
                <div className="flex items-center justify-between border-b border-border pb-2">
                  <span className="font-semibold text-sm">
                    Buffer Setup (Connect multiple social channels with 1 token)
                  </span>
                  <a
                    href="https://publish.buffer.com/developers/apps"
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline inline-flex items-center gap-1 font-medium hover:text-primary/80"
                  >
                    Buffer Developer Apps <ExternalLink className="h-3 w-3" />
                  </a>
                </div>

                <ol className="list-decimal ml-4 space-y-1.5 text-muted-foreground">
                  <li>
                    Connect all your channels (X, LinkedIn, Facebook, Instagram, etc.) in your Buffer account at{" "}
                    <a
                      href="https://publish.buffer.com/channels"
                      target="_blank"
                      rel="noreferrer"
                      className="underline text-foreground"
                    >
                      publish.buffer.com/channels
                    </a>.
                  </li>
                  <li>
                    Open{" "}
                    <a
                      href="https://publish.buffer.com/developers/apps"
                      target="_blank"
                      rel="noreferrer"
                      className="underline text-foreground"
                    >
                      publish.buffer.com/developers/apps
                    </a>{" "}
                    and sign in.
                  </li>
                  <li>Click <strong>Create Application</strong> (any app name, callback URL can be <code>http://localhost</code>).</li>
                  <li>Copy the <strong>Access Token</strong> displayed for your app.</li>
                  <li>Scroll down to the <strong>Buffer</strong> section below and paste your token. All linked channels will appear automatically.</li>
                </ol>
              </div>
            )}
          </div>

          <div className="flex items-start gap-2.5 text-xs text-muted-foreground border border-dashed border-border p-3.5 rounded bg-muted/20">
            <ShieldCheck className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
            <div>
              <strong className="text-foreground">Zero Limitations:</strong>
              <p className="mt-0.5">
                You can add as many custom providers or webhooks as you need. All custom providers will automatically appear in your
                <strong> Multi-Platform Composer (/crear)</strong> alongside the core networks!
              </p>
            </div>
          </div>
        </div>
      </SectionDisclosure>

      {/* Standard Platform Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span>Connect {targetConfig ? targetConfig.label : ""}</span>
            </DialogTitle>
            <DialogDescription>
              Enter your authentication token or access credential. All keys are encrypted at rest with AES-GCM.
            </DialogDescription>
          </DialogHeader>

          {targetPlatform === "x" ? (
            <div className="space-y-4 py-2 text-sm text-muted-foreground">
              <div className="border border-border p-3.5 rounded-lg bg-muted/20 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <strong className="text-foreground font-semibold">How to get X (Twitter) API Keys:</strong>
                  <a
                    href="https://developer.x.com/en/portal/dashboard"
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline inline-flex items-center gap-0.5"
                  >
                    X Developer Portal <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                </div>
                <ol className="list-decimal ml-4 space-y-1 text-muted-foreground">
                  <li>Create a Project &amp; App in the X Developer Portal.</li>
                  <li>Under App Settings &gt; <strong>User authentication settings</strong>, set App permissions to <strong>Read and Write</strong>.</li>
                  <li>Under <strong>Keys and tokens</strong>, generate your Consumer Keys and Access Tokens.</li>
                </ol>
              </div>
              <Button onClick={() => setDialogOpen(false)} className="w-full">
                Go to Dedicated X (Twitter) Section Below
              </Button>
            </div>
          ) : (
            <div className="space-y-4 py-2">
              {targetConfig?.guide && (
                <div className="border border-border p-3.5 rounded-lg bg-muted/30 text-xs space-y-2.5">
                  <div className="flex items-center justify-between border-b border-border pb-1.5">
                    <span className="font-semibold text-foreground flex items-center gap-1.5">
                      <BookOpen className="h-3.5 w-3.5 text-primary" />
                      How to get this API key:
                    </span>
                    <a
                      href={targetConfig.guide.portalUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary underline inline-flex items-center gap-1 hover:text-primary/80 font-medium"
                    >
                      {targetConfig.guide.portalName} <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  </div>

                  <ol className="list-decimal ml-4 space-y-1 text-muted-foreground">
                    {targetConfig.guide.steps.map((st, idx) => (
                      <li key={idx} className="leading-relaxed">
                        {st}
                      </li>
                    ))}
                  </ol>

                  {targetConfig.guide.requiredScopes && (
                    <div className="pt-1">
                      <span className="text-[11px] font-medium text-foreground block mb-1">
                        Required Scopes:
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {targetConfig.guide.requiredScopes.map((sc) => (
                          <button
                            key={sc}
                            type="button"
                            onClick={() => copyToClipboard(sc, sc)}
                            className="font-mono text-[10px] bg-card px-2 py-0.5 rounded border border-border inline-flex items-center gap-1 hover:bg-muted"
                            title="Click to copy"
                          >
                            {sc} <Copy className="h-2.5 w-2.5 opacity-60" />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-1.5">
                <Label className="text-xs">Account Label / Identifier (Optional)</Label>
                <Input
                  placeholder="e.g. Corporate Profile, Marketing Page"
                  value={labelInput}
                  onChange={(e) => setLabelInput(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">
                  {targetPlatform === "linkedin"
                    ? "LinkedIn OAuth 2.0 Access Token"
                    : targetPlatform === "facebook"
                      ? "Facebook Page Access Token"
                      : "Instagram Graph Access Token"}
                </Label>
                <Input
                  type="password"
                  placeholder="Paste access token here..."
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  className="font-mono text-xs"
                />
              </div>
            </div>
          )}

          {targetPlatform !== "x" && (
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={handleSaveStandard} disabled={busy} className="gap-1.5">
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Save &amp; Connect
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {/* Add Custom Provider Dialog */}
      <Dialog open={customDialogOpen} onOpenChange={setCustomDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-serif text-xl">
              <Globe className="h-5 w-5 text-primary" />
              Add Custom API Key Provider / Webhook
            </DialogTitle>
            <DialogDescription>
              Connect Threads, Bluesky, TikTok, Telegram, Discord, or any custom REST API / Webhook.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 text-xs">
            {/* Quick Preset Selector */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Select Provider Preset</Label>
              <Select value={customPreset} onValueChange={onPresetChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a preset..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="threads">🧵 Threads (Meta Threads API)</SelectItem>
                  <SelectItem value="bluesky">🦋 Bluesky (AT Protocol / App Password)</SelectItem>
                  <SelectItem value="tiktok">🎵 TikTok (Content Posting API)</SelectItem>
                  <SelectItem value="telegram">✈️ Telegram (Bot Token &amp; Channel)</SelectItem>
                  <SelectItem value="discord">💬 Discord (Webhook URL)</SelectItem>
                  <SelectItem value="custom_webhook">🌐 Custom Webhook / REST API Endpoint</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Provider Guide for Selected Preset */}
            {POPULAR_PRESETS[customPreset]?.guide && (
              <div className="border border-border p-3 rounded-lg bg-muted/30 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-foreground">
                    {POPULAR_PRESETS[customPreset].label} Setup Guide:
                  </span>
                  {POPULAR_PRESETS[customPreset].guide!.portalUrl !== "#" && (
                    <a
                      href={POPULAR_PRESETS[customPreset].guide!.portalUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary underline inline-flex items-center gap-0.5 text-[11px]"
                    >
                      {POPULAR_PRESETS[customPreset].guide!.portalName} <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  )}
                </div>
                <ol className="list-decimal ml-4 space-y-1 text-muted-foreground text-[11px]">
                  {POPULAR_PRESETS[customPreset].guide!.steps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
              </div>
            )}

            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Provider Label / Name</Label>
                <Input
                  value={customLabel}
                  onChange={(e) => setCustomLabel(e.target.value)}
                  placeholder="e.g. Threads Official"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Platform Key (ID)</Label>
                <Input
                  value={customKey}
                  onChange={(e) => setCustomKey(e.target.value)}
                  placeholder="e.g. threads, discord_alerts"
                  className="font-mono text-xs"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">API Key / Token / Webhook URL</Label>
              <Input
                type="password"
                value={customApiKey}
                onChange={(e) => setCustomApiKey(e.target.value)}
                placeholder="Paste your API key, access token, or full webhook URL..."
                className="font-mono text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">
                Base URL / Endpoint / Channel ID (Optional)
              </Label>
              <Input
                value={customBaseUrl}
                onChange={(e) => setCustomBaseUrl(e.target.value)}
                placeholder="e.g. https://api.mysite.com/posts or @mychannel"
                className="font-mono text-xs"
              />
              <p className="text-[10px] text-muted-foreground">
                For Telegram: channel @username (e.g. @mychannel). For webhooks: HTTP endpoint URL if not in API Key.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Character Limit</Label>
                <Input
                  type="number"
                  value={customCharLimit}
                  onChange={(e) => setCustomCharLimit(e.target.value)}
                  placeholder="5000"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Icon Emoji</Label>
                <Input
                  value={customIcon}
                  onChange={(e) => setCustomIcon(e.target.value)}
                  placeholder="🧵"
                />
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCustomDialogOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={handleSaveCustom} disabled={busy} className="gap-1.5">
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save &amp; Connect Provider
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
