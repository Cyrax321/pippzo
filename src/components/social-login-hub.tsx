import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { startSocialLoginFn } from "@/lib/oauth.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Loader2,
  CheckCircle2,
  ExternalLink,
  ShieldCheck,
  LogIn,
  KeyRound,
  Trash2,
  RefreshCw,
  Sparkles,
  HelpCircle,
  Info,
  BookOpen,
  ChevronDown,
  ChevronUp,
  ArrowRight,
} from "lucide-react";

interface SocialLoginHubProps {
  workspaceId: string | null;
  xConnected: boolean;
  xUsername?: string;
  xAvatar?: string;
  onDisconnectX?: () => Promise<void>;
  bufferConnected: boolean;
  bufferChannelsCount?: number;
  onDisconnectBuffer?: () => Promise<void>;
  unipileConnected: boolean;
  linkedAccounts?: Array<{ network: string; name: string; status: string }>;
  onRefresh?: () => void;
}

export function SocialLoginHub({
  workspaceId,
  xConnected,
  xUsername,
  xAvatar,
  onDisconnectX,
  bufferConnected,
  bufferChannelsCount = 0,
  onDisconnectBuffer,
  unipileConnected,
  linkedAccounts = [],
  onRefresh,
}: SocialLoginHubProps) {
  const startLogin = useServerFn(startSocialLoginFn);
  const [connectingPlatform, setConnectingPlatform] = useState<string | null>(null);

  // Custom client ID toggle for X if self-hosted
  const [showXAppConfig, setShowXAppConfig] = useState(false);
  const [xClientId, setXClientId] = useState("");
  const [xClientSecret, setXClientSecret] = useState("");

  // Buffer client ID if self-hosted
  const [showBufferConfig, setShowBufferConfig] = useState(false);
  const [bufferClientId, setBufferClientId] = useState("");
  const [bufferClientSecret, setBufferClientSecret] = useState("");

  // Step-by-step instructions toggle
  const [showInstructions, setShowInstructions] = useState(false);

  const handleConnect = async (platform: "x" | "buffer" | "linkedin" | "instagram" | "whatsapp" | "threads") => {
    if (!workspaceId) {
      toast.error("Please select a workspace first.");
      return;
    }

    if (
      (platform === "linkedin" || platform === "instagram" || platform === "whatsapp" || platform === "threads") &&
      !unipileConnected
    ) {
      toast.info(
        "Direct account login requires Unipile. Enter your Unipile DSN & API Key below, or use Buffer above to publish to LinkedIn & Instagram.",
        { duration: 6000 }
      );
      window.location.hash = "unipile-section";
      document.getElementById("unipile-section")?.scrollIntoView({ behavior: "smooth" });
      return;
    }

    setConnectingPlatform(platform);
    try {
      const payload: any = {
        workspaceId,
        platform,
        origin: window.location.origin,
      };

      if (platform === "x" && xClientId.trim()) {
        payload.clientId = xClientId.trim();
        payload.clientSecret = xClientSecret.trim() || undefined;
      }

      if (platform === "buffer" && bufferClientId.trim()) {
        payload.clientId = bufferClientId.trim();
        payload.clientSecret = bufferClientSecret.trim() || undefined;
      }

      const res = await startLogin({ data: payload });

      if (res.mode === "redirect") {
        toast.info(`Redirecting to ${platform.toUpperCase()} authorization…`);
        window.location.href = res.url;
      } else {
        window.open(res.url, "_blank", "noopener,width=600,height=700");
        toast.info(`Complete your ${platform} login in the popup window, then click Refresh.`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to connect ${platform}`);
    } finally {
      setConnectingPlatform(null);
    }
  };

  const isLinkedInLinked = linkedAccounts.some((a) => a.network.toLowerCase().includes("linkedin"));
  const isInstagramLinked = linkedAccounts.some((a) => a.network.toLowerCase().includes("instagram"));
  const isWhatsAppLinked = linkedAccounts.some((a) => a.network.toLowerCase().includes("whatsapp"));

  return (
    <div className="space-y-6">
      {/* Header banner */}
      <div className="bg-gradient-to-r from-primary/10 via-accent/15 to-primary/5 border border-primary/20 rounded-xl p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-1 max-w-xl">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary/20 text-primary mb-1">
              <Sparkles className="h-3.5 w-3.5" /> 1-Click Account Login
            </div>
            <h2 className="text-xl font-serif font-bold tracking-tight">Connect with Your Account Logins</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              No need to generate or paste API keys. Simply click <strong>Log in with Account</strong> to securely authorize your social media channels.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowInstructions(!showInstructions)}
              className="gap-1.5 shrink-0 bg-background/80 text-xs font-medium"
            >
              <HelpCircle className="h-3.5 w-3.5 text-primary" />
              <span>{showInstructions ? "Hide Instructions" : "How to Connect (Instructions)"}</span>
              {showInstructions ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </Button>
            {onRefresh && (
              <Button
                variant="outline"
                size="sm"
                onClick={onRefresh}
                className="gap-2 shrink-0 bg-background/80"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Refresh Status
              </Button>
            )}
          </div>
        </div>

        {/* Expandable Step-by-Step Instructions */}
        {showInstructions && (
          <div className="mt-4 pt-4 border-t border-primary/20 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Option 1: Buffer (Publishing) */}
              <div className="bg-background/95 p-4 rounded-lg border border-border/70 space-y-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="h-6 w-6 rounded bg-blue-600 text-white flex items-center justify-center font-bold text-xs select-none">
                    ⚡
                  </span>
                  <div>
                    <h4 className="font-semibold text-foreground text-sm">Option A: Buffer (For Publishing)</h4>
                    <p className="text-[11px] text-muted-foreground">Best for scheduled posts, reels &amp; carousels</p>
                  </div>
                </div>
                <p className="text-muted-foreground">
                  Connects <strong>LinkedIn, Instagram, TikTok &amp; Facebook</strong> in 1 click without needing any developer portal apps or Unipile setup.
                </p>
                <ol className="list-decimal ml-4 space-y-1 text-muted-foreground">
                  <li>Click <strong>Log in with Buffer</strong> on the card below.</li>
                  <li>Sign into your Buffer account and grant access in the popup.</li>
                  <li>All your active social channels in Buffer will be ready to publish!</li>
                </ol>
              </div>

              {/* Option 2: Unipile (Direct Login & DMs) */}
              <div className="bg-background/95 p-4 rounded-lg border border-border/70 space-y-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="h-6 w-6 rounded bg-primary/20 text-primary flex items-center justify-center font-bold text-xs select-none">
                    <LogIn className="h-3.5 w-3.5" />
                  </span>
                  <div>
                    <h4 className="font-semibold text-foreground text-sm">Option B: Unipile (Direct Login &amp; DMs)</h4>
                    <p className="text-[11px] text-muted-foreground">For direct account login, comments &amp; DMs</p>
                  </div>
                </div>
                <p className="text-muted-foreground">
                  Connects your <strong>LinkedIn, Instagram &amp; WhatsApp</strong> accounts directly for real-time messaging, comments, and direct DMs.
                </p>
                <ol className="list-decimal ml-4 space-y-1 text-muted-foreground">
                  <li>
                    Create a free account at{" "}
                    <a
                      href="https://www.unipile.com"
                      target="_blank"
                      rel="noreferrer"
                      className="underline text-foreground font-semibold inline-flex items-center gap-0.5 hover:text-primary"
                    >
                      unipile.com <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  </li>
                  <li>In your Unipile dashboard, copy your <strong>DSN</strong> and <strong>API Key</strong>.</li>
                  <li>
                    Scroll down to the{" "}
                    <a
                      href="#unipile-section"
                      onClick={(e) => {
                        e.preventDefault();
                        window.location.hash = "unipile-section";
                        document.getElementById("unipile-section")?.scrollIntoView({ behavior: "smooth" });
                      }}
                      className="text-primary hover:underline font-semibold"
                    >
                      Engagement (Unipile) section ↓
                    </a>{" "}
                    and click <strong>Connect Unipile</strong>.
                  </li>
                  <li>Click <strong>Log in with LinkedIn / Instagram</strong> or scan the WhatsApp QR code!</li>
                </ol>
              </div>
            </div>

            <div className="bg-background/70 p-3 rounded-lg border border-border/50 text-[11px] text-muted-foreground flex items-center justify-between gap-2 flex-wrap">
              <span>
                💡 <strong>Which should I use?</strong> Use <strong>Buffer</strong> if you only want to publish scheduled content. Use <strong>Unipile</strong> if you also want Pippzo to read and reply to comments &amp; DMs.
              </span>
              <button
                type="button"
                onClick={() => setShowInstructions(false)}
                className="text-primary hover:underline font-medium shrink-0 cursor-pointer"
              >
                Close guide ✕
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Grid of channel login cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 1. X (Twitter) Card */}
        <div className="border border-border/80 bg-card rounded-xl p-5 shadow-xs flex flex-col justify-between space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-black text-white dark:bg-white dark:text-black flex items-center justify-center font-bold text-lg select-none">
                𝕏
              </div>
              <div>
                <h3 className="font-semibold text-base leading-tight">X (Twitter)</h3>
                <p className="text-xs text-muted-foreground">Post tweets, threads &amp; monitor engagement</p>
              </div>
            </div>
            {xConnected ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                <CheckCircle2 className="h-3 w-3" /> Connected
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">Not connected</span>
            )}
          </div>

          {xConnected ? (
            <div className="space-y-3 pt-2 border-t border-border/50">
              <div className="flex items-center justify-between gap-3 bg-muted/40 p-2.5 rounded-lg">
                <div className="flex items-center gap-2.5">
                  {xAvatar ? (
                    <img src={xAvatar} alt="" className="h-8 w-8 rounded-full object-cover" />
                  ) : (
                    <div className="h-8 w-8 rounded-full bg-foreground/10 grid place-items-center text-xs font-bold">𝕏</div>
                  )}
                  <div>
                    <div className="font-medium text-sm">@{xUsername || "connected"}</div>
                    <div className="text-[11px] text-muted-foreground">OAuth 2.0 authorized</div>
                  </div>
                </div>
                {onDisconnectX && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onDisconnectX}
                    className="text-destructive hover:bg-destructive/10 h-8 gap-1.5 text-xs"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Disconnect
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3 pt-2">
              <Button
                onClick={() => handleConnect("x")}
                disabled={connectingPlatform === "x"}
                className="w-full gap-2 font-medium bg-black hover:bg-neutral-800 text-white dark:bg-white dark:text-black dark:hover:bg-neutral-200"
              >
                {connectingPlatform === "x" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <LogIn className="h-4 w-4" /> Log in with X
                  </>
                )}
              </Button>

              <div className="flex items-center justify-between text-[11px] text-muted-foreground px-1">
                <button
                  type="button"
                  onClick={() => setShowXAppConfig(!showXAppConfig)}
                  className="underline hover:text-foreground cursor-pointer flex items-center gap-1"
                >
                  <KeyRound className="h-3 w-3" /> {showXAppConfig ? "Hide custom App settings" : "Custom Client ID"}
                </button>
                <a
                  href="https://developer.x.com/en/portal/dashboard"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 hover:text-foreground"
                >
                  X Developer Portal <ExternalLink className="h-2.5 w-2.5" />
                </a>
              </div>

              {showXAppConfig && (
                <div className="bg-muted/40 p-3 rounded-lg border border-border/60 space-y-2 text-xs">
                  <div className="space-y-1">
                    <Label htmlFor="x-client-id" className="text-[11px]">OAuth 2.0 Client ID</Label>
                    <Input
                      id="x-client-id"
                      value={xClientId}
                      onChange={(e) => setXClientId(e.target.value)}
                      placeholder="e.g. UzF... (from Twitter App Settings)"
                      className="h-8 text-xs font-mono"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="x-client-secret" className="text-[11px]">Client Secret (Optional for public apps)</Label>
                    <Input
                      id="x-client-secret"
                      type="password"
                      value={xClientSecret}
                      onChange={(e) => setXClientSecret(e.target.value)}
                      placeholder="Optional"
                      className="h-8 text-xs font-mono"
                    />
                  </div>
                  <div className="space-y-1.5 pt-1 text-[11px] text-muted-foreground">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-foreground">Callback URI for Twitter Portal:</span>
                      <button
                        type="button"
                        onClick={() => {
                          const cb = typeof window !== "undefined" ? `${window.location.origin}/api/oauth/x/callback` : "http://localhost:5173/api/oauth/x/callback";
                          navigator.clipboard.writeText(cb);
                          toast.success("Callback URL copied to clipboard");
                        }}
                        className="text-[10px] text-primary hover:underline cursor-pointer"
                      >
                        Copy URL
                      </button>
                    </div>
                    <code className="block bg-background px-2 py-1 rounded font-mono text-[10px] select-all border border-border/60 break-all">
                      {typeof window !== "undefined" ? `${window.location.origin}/api/oauth/x/callback` : "http://localhost:5173/api/oauth/x/callback"}
                    </code>
                    <div className="bg-background/60 p-2 rounded border border-border/40 space-y-1 text-[10px]">
                      <p className="font-semibold text-foreground">Required in X Developer Portal (User Authentication Settings):</p>
                      <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
                        <li><strong>App permissions:</strong> Read and write</li>
                        <li><strong>Type of App:</strong> Web App, Automated App or Bot</li>
                        <li><strong>Callback URI:</strong> Must match the URL above exactly (no trailing slash)</li>
                        <li><strong>Website URL:</strong> <code>http://localhost:5173</code></li>
                      </ul>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 2. Buffer Card (LinkedIn, Instagram, TikTok, Facebook) */}
        <div className="border border-border/80 bg-card rounded-xl p-5 shadow-xs flex flex-col justify-between space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-lg select-none">
                ⚡
              </div>
              <div>
                <h3 className="font-semibold text-base leading-tight">Buffer</h3>
                <p className="text-xs text-muted-foreground">Multi-channel: LinkedIn, Instagram, TikTok &amp; Facebook</p>
              </div>
            </div>
            {bufferConnected ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                <CheckCircle2 className="h-3 w-3" /> Connected
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">Not connected</span>
            )}
          </div>

          {bufferConnected ? (
            <div className="space-y-3 pt-2 border-t border-border/50">
              <div className="flex items-center justify-between gap-3 bg-muted/40 p-2.5 rounded-lg">
                <div>
                  <div className="font-medium text-sm">{bufferChannelsCount} channels active</div>
                  <div className="text-[11px] text-muted-foreground">Scheduled publishing ready</div>
                </div>
                {onDisconnectBuffer && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onDisconnectBuffer}
                    className="text-destructive hover:bg-destructive/10 h-8 gap-1.5 text-xs"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Disconnect
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3 pt-2">
              <Button
                onClick={() => handleConnect("buffer")}
                disabled={connectingPlatform === "buffer"}
                className="w-full gap-2 font-medium bg-blue-600 hover:bg-blue-700 text-white"
              >
                {connectingPlatform === "buffer" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <LogIn className="h-4 w-4" /> Log in with Buffer
                  </>
                )}
              </Button>

              <div className="flex items-center justify-between text-[11px] text-muted-foreground px-1">
                <button
                  type="button"
                  onClick={() => setShowBufferConfig(!showBufferConfig)}
                  className="underline hover:text-foreground cursor-pointer flex items-center gap-1"
                >
                  <KeyRound className="h-3 w-3" /> {showBufferConfig ? "Hide custom App settings" : "Custom Buffer App"}
                </button>
                <a
                  href="https://buffer.com/manage/apps"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 hover:text-foreground"
                >
                  Buffer Apps <ExternalLink className="h-2.5 w-2.5" />
                </a>
              </div>

              {showBufferConfig && (
                <div className="bg-muted/40 p-3 rounded-lg border border-border/60 space-y-2 text-xs">
                  <div className="space-y-1">
                    <Label htmlFor="buf-client-id" className="text-[11px]">Buffer Client ID</Label>
                    <Input
                      id="buf-client-id"
                      value={bufferClientId}
                      onChange={(e) => setBufferClientId(e.target.value)}
                      placeholder="From buffer.com/manage/apps"
                      className="h-8 text-xs font-mono"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="buf-client-secret" className="text-[11px]">Buffer Client Secret</Label>
                    <Input
                      id="buf-client-secret"
                      type="password"
                      value={bufferClientSecret}
                      onChange={(e) => setBufferClientSecret(e.target.value)}
                      placeholder="Client Secret"
                      className="h-8 text-xs font-mono"
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 3. LinkedIn Login Card */}
        <div className="border border-border/80 bg-card rounded-xl p-5 shadow-xs flex flex-col justify-between space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-[#0077B5] text-white flex items-center justify-center font-bold text-lg select-none">
                in
              </div>
              <div>
                <h3 className="font-semibold text-base leading-tight">LinkedIn</h3>
                <p className="text-xs text-muted-foreground">Direct account login for posts, DMs &amp; comments</p>
              </div>
            </div>
            {isLinkedInLinked ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                <CheckCircle2 className="h-3 w-3" /> Connected
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">Not connected</span>
            )}
          </div>

          <div className="space-y-2 pt-2">
            <Button
              onClick={() => handleConnect("linkedin")}
              disabled={connectingPlatform === "linkedin"}
              variant={isLinkedInLinked ? "outline" : "default"}
              className={`w-full gap-2 font-medium ${!isLinkedInLinked ? "bg-[#0077B5] hover:bg-[#006097] text-white" : ""}`}
            >
              {connectingPlatform === "linkedin" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isLinkedInLinked ? (
                <>
                  <RefreshCw className="h-4 w-4" /> Re-authenticate LinkedIn
                </>
              ) : (
                <>
                  <LogIn className="h-4 w-4" /> Log in with LinkedIn
                </>
              )}
            </Button>
            <p className="text-[11px] text-muted-foreground text-center">
              Opens a secure login window to sign into your LinkedIn account directly.
            </p>
            {!isLinkedInLinked && !unipileConnected && (
              <div className="flex items-center justify-between text-[11px] bg-muted/40 px-2.5 py-1.5 rounded border border-border/50">
                <span className="text-muted-foreground">Requires Unipile gateway</span>
                <a
                  href="#unipile-section"
                  onClick={(e) => {
                    e.preventDefault();
                    window.location.hash = "unipile-section";
                    document.getElementById("unipile-section")?.scrollIntoView({ behavior: "smooth" });
                  }}
                  className="text-primary hover:underline font-medium cursor-pointer"
                >
                  Configure below ↓
                </a>
              </div>
            )}
          </div>
        </div>

        {/* 4. Instagram Login Card */}
        <div className="border border-border/80 bg-card rounded-xl p-5 shadow-xs flex flex-col justify-between space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-gradient-to-tr from-[#f09433] via-[#dc2743] to-[#bc1888] text-white flex items-center justify-center font-bold text-lg select-none">
                📷
              </div>
              <div>
                <h3 className="font-semibold text-base leading-tight">Instagram</h3>
                <p className="text-xs text-muted-foreground">Direct account login for reels, comments &amp; stories</p>
              </div>
            </div>
            {isInstagramLinked ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                <CheckCircle2 className="h-3 w-3" /> Connected
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">Not connected</span>
            )}
          </div>

          <div className="space-y-2 pt-2">
            <Button
              onClick={() => handleConnect("instagram")}
              disabled={connectingPlatform === "instagram"}
              variant={isInstagramLinked ? "outline" : "default"}
              className={`w-full gap-2 font-medium ${!isInstagramLinked ? "bg-gradient-to-r from-[#dc2743] to-[#bc1888] hover:opacity-90 text-white" : ""}`}
            >
              {connectingPlatform === "instagram" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isInstagramLinked ? (
                <>
                  <RefreshCw className="h-4 w-4" /> Re-authenticate Instagram
                </>
              ) : (
                <>
                  <LogIn className="h-4 w-4" /> Log in with Instagram
                </>
              )}
            </Button>
            <p className="text-[11px] text-muted-foreground text-center">
              Log into your Instagram Creator or Business account in a secure modal.
            </p>
            {!isInstagramLinked && !unipileConnected && (
              <div className="flex items-center justify-between text-[11px] bg-muted/40 px-2.5 py-1.5 rounded border border-border/50">
                <span className="text-muted-foreground">Requires Unipile gateway</span>
                <a
                  href="#unipile-section"
                  onClick={(e) => {
                    e.preventDefault();
                    window.location.hash = "unipile-section";
                    document.getElementById("unipile-section")?.scrollIntoView({ behavior: "smooth" });
                  }}
                  className="text-primary hover:underline font-medium cursor-pointer"
                >
                  Configure below ↓
                </a>
              </div>
            )}
          </div>
        </div>

        {/* 5. WhatsApp & Messenger Card */}
        <div className="border border-border/80 bg-card rounded-xl p-5 shadow-xs flex flex-col justify-between space-y-4 md:col-span-2">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-[#25D366] text-white flex items-center justify-center font-bold text-lg select-none">
                💬
              </div>
              <div>
                <h3 className="font-semibold text-base leading-tight">WhatsApp Business</h3>
                <p className="text-xs text-muted-foreground">Scan QR code with your phone to link your WhatsApp inbox</p>
              </div>
            </div>
            {isWhatsAppLinked ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                <CheckCircle2 className="h-3 w-3" /> Connected
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">Not connected</span>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-3 flex-wrap">
              <Button
                onClick={() => handleConnect("whatsapp")}
                disabled={connectingPlatform === "whatsapp"}
                className="gap-2 font-medium bg-[#25D366] hover:bg-[#20ba59] text-white"
              >
                {connectingPlatform === "whatsapp" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <LogIn className="h-4 w-4" /> Link WhatsApp with QR Code
                  </>
                )}
              </Button>
              <span className="text-xs text-muted-foreground">
                Pairs in seconds by scanning the QR code inside WhatsApp → Linked Devices.
              </span>
            </div>
            {!isWhatsAppLinked && !unipileConnected && (
              <div className="flex items-center justify-between text-[11px] bg-muted/40 px-2.5 py-1.5 rounded border border-border/50 max-w-md">
                <span className="text-muted-foreground">WhatsApp inbox connection requires Unipile</span>
                <a
                  href="#unipile-section"
                  onClick={(e) => {
                    e.preventDefault();
                    window.location.hash = "unipile-section";
                    document.getElementById("unipile-section")?.scrollIntoView({ behavior: "smooth" });
                  }}
                  className="text-primary hover:underline font-medium cursor-pointer"
                >
                  Configure below ↓
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
