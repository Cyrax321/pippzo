import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  getXStatusFn,
  saveXCredentialsFn,
  disconnectXFn,
  syncXMentionsFn,
  postTweetFn,
} from "@/lib/x/x.functions";
import { startSocialLoginFn } from "@/lib/oauth.functions";
import type { XConnectionStatus } from "@/lib/x/x.server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { SectionDisclosure } from "@/components/section-disclosure";
import {
  Loader2,
  Trash2,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Send,
  ExternalLink,
  ShieldCheck,
  LogIn,
  Sparkles,
} from "lucide-react";

export function XConnectionSection({ workspaceId }: { workspaceId: string | null }) {
  const getStatus = useServerFn(getXStatusFn);
  const saveCredentials = useServerFn(saveXCredentialsFn);
  const disconnect = useServerFn(disconnectXFn);
  const syncMentions = useServerFn(syncXMentionsFn);
  const postTweet = useServerFn(postTweetFn);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<XConnectionStatus | null>(null);

  // Form mode
  const [authMode, setAuthMode] = useState<"1click" | "api_keys" | "oauth2">("1click");

  // 1-Click OAuth state
  const startLogin = useServerFn(startSocialLoginFn);
  const [oauthClientId, setOauthClientId] = useState("");
  const [oauthClientSecret, setOauthClientSecret] = useState("");
  const [oauthConnecting, setOauthConnecting] = useState(false);

  const on1ClickLogin = async () => {
    if (!workspaceId) return;
    setOauthConnecting(true);
    try {
      const res = await startLogin({
        data: {
          workspaceId,
          platform: "x",
          origin: window.location.origin,
          clientId: oauthClientId.trim() || undefined,
          clientSecret: oauthClientSecret.trim() || undefined,
        },
      });
      window.location.href = res.url;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start X login flow");
      setOauthConnecting(false);
    }
  };

  // API keys fields
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [oauthToken, setOauthToken] = useState("");
  const [oauthTokenSecret, setOauthTokenSecret] = useState("");

  // OAuth 2.0 fields
  const [accessToken, setAccessToken] = useState("");
  const [refreshToken, setRefreshToken] = useState("");

  // Quick test tweet
  const [testTweetText, setTestTweetText] = useState("");
  const [sendingTest, setSendingTest] = useState(false);

  const load = useCallback(() => {
    if (!workspaceId) return;
    setLoading(true);
    getStatus({ data: { workspaceId } })
      .then((st) => setStatus(st))
      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed to load X status"))
      .finally(() => setLoading(false));
  }, [workspaceId, getStatus]);

  useEffect(load, [load]);

  const onSave = async () => {
    if (!workspaceId) return;
    setBusy(true);
    try {
      const payload: any = {
        workspaceId,
        authMode,
      };

      if (authMode === "api_keys") {
        if (!apiKey.trim() || !apiSecret.trim() || !oauthToken.trim() || !oauthTokenSecret.trim()) {
          toast.error("Please fill in API Key, API Secret, Access Token, and Token Secret.");
          setBusy(false);
          return;
        }
        payload.apiKey = apiKey.trim();
        payload.apiSecret = apiSecret.trim();
        payload.oauthToken = oauthToken.trim();
        payload.oauthTokenSecret = oauthTokenSecret.trim();
      } else {
        if (!accessToken.trim()) {
          toast.error("Please provide an OAuth 2.0 Access Token.");
          setBusy(false);
          return;
        }
        payload.accessToken = accessToken.trim();
        payload.refreshToken = refreshToken.trim() || undefined;
      }

      const res = await saveCredentials({ data: payload });
      setStatus(res);
      toast.success(res.connected ? `Connected to X as @${res.username}` : "Credentials saved");
      // Clear sensitive fields from form state
      setApiKey("");
      setApiSecret("");
      setOauthToken("");
      setOauthTokenSecret("");
      setAccessToken("");
      setRefreshToken("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save X credentials");
    } finally {
      setBusy(false);
    }
  };

  const onDisconnect = async () => {
    if (!workspaceId) return;
    if (!confirm("Disconnect X account? The agent will no longer be able to post or read tweets directly.")) {
      return;
    }
    setBusy(true);
    try {
      await disconnect({ data: { workspaceId } });
      setStatus({ connected: false, status: "disconnected" });
      toast.success("X disconnected");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to disconnect X");
    } finally {
      setBusy(false);
    }
  };

  const onSync = async () => {
    if (!workspaceId) return;
    setBusy(true);
    try {
      const res = await syncMentions({ data: { workspaceId } });
      toast.success(`Synced ${res.ingested} mention${res.ingested === 1 ? "" : "s"} into Engagement inbox`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to sync X mentions");
    } finally {
      setBusy(false);
    }
  };

  const onSendTest = async () => {
    if (!workspaceId || !testTweetText.trim()) return;
    setSendingTest(true);
    try {
      const res = await postTweet({
        data: { workspaceId, text: testTweetText.trim() },
      });
      if (res.ok) {
        toast.success(`Test post published to X! (${res.tweetId})`);
        setTestTweetText("");
      } else {
        toast.error(res.error || "Failed to post to X");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to post to X");
    } finally {
      setSendingTest(false);
    }
  };

  return (
    <SectionDisclosure
      icon={<span className="font-bold text-sm tracking-tighter">𝕏</span>}
      title="X (Twitter)"
      subtitle="x.com · Native autonomous operator"
      badge={
        loading ? (
          <span className="font-mono text-[10px] tabular-nums border border-border text-muted-foreground px-2 py-1 inline-flex items-center gap-1.5">
            <Loader2 className="h-3 w-3 animate-spin" /> CHECKING
          </span>
        ) : status?.connected ? (
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] tabular-nums border border-foreground px-2 py-1">
            <CheckCircle2 className="h-3 w-3 text-emerald-500" /> CONNECTED (@{status.username})
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] tabular-nums border border-border text-muted-foreground px-2 py-1">
            <AlertTriangle className="h-3 w-3" /> NOT CONNECTED
          </span>
        )
      }
    >
      <div className="px-5 py-5 space-y-5">
        <p className="text-sm text-muted-foreground">
          Connect your X account so Pippzo can autonomously publish posts, schedule tweets, attach media,
          reply to mentions, like posts, and manage inbox engagement directly. All keys are encrypted at rest using AES-GCM.
        </p>

        {!loading && !status?.connected && (
          <div className="space-y-5 border border-border p-4 bg-muted/20">
            <div className="flex items-center gap-2 border-b border-border pb-3 flex-wrap">
              <button
                type="button"
                onClick={() => setAuthMode("1click")}
                className={`text-xs uppercase font-mono px-3 py-1.5 transition-colors flex items-center gap-1.5 ${
                  authMode === "1click"
                    ? "bg-foreground text-background font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Sparkles className="h-3 w-3" /> 1-Click Login (Recommended)
              </button>
              <button
                type="button"
                onClick={() => setAuthMode("api_keys")}
                className={`text-xs uppercase font-mono px-3 py-1.5 transition-colors ${
                  authMode === "api_keys"
                    ? "bg-foreground text-background font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                API Key + Access Token
              </button>
              <button
                type="button"
                onClick={() => setAuthMode("oauth2")}
                className={`text-xs uppercase font-mono px-3 py-1.5 transition-colors ${
                  authMode === "oauth2"
                    ? "bg-foreground text-background font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                OAuth 2.0 User Token
              </button>
            </div>

            {authMode === "1click" && (
              <div className="space-y-4 pt-1">
                <div className="bg-primary/5 border border-primary/20 rounded-lg p-3.5 space-y-1.5">
                  <div className="flex items-center gap-2 font-medium text-sm">
                    <Sparkles className="h-4 w-4 text-primary" />
                    <span>Direct X Account Authorization</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Authenticate your X account in one click via OAuth 2.0 PKCE. No consumer keys or secrets required to copy manually.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs">Twitter App Client ID (from developer.x.com)</Label>
                  <Input
                    value={oauthClientId}
                    onChange={(e) => setOauthClientId(e.target.value)}
                    placeholder="Enter your Twitter App Client ID (or configure X_CLIENT_ID in .env)"
                    className="font-mono text-xs"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Required redirect URI in your Twitter App User Authentication Settings:{" "}
                    <code className="bg-muted px-1.5 py-0.5 rounded font-mono text-[10px]">
                      {typeof window !== "undefined" ? `${window.location.origin}/api/oauth/x/callback` : "/api/oauth/x/callback"}
                    </code>
                  </p>
                </div>

                <Button
                  onClick={on1ClickLogin}
                  disabled={oauthConnecting}
                  className="w-full gap-2 font-medium bg-black hover:bg-neutral-800 text-white dark:bg-white dark:text-black dark:hover:bg-neutral-200"
                >
                  {oauthConnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
                  Log in with X (Twitter)
                </Button>
              </div>
            )}

            <div className="space-y-2 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">
                How to set up credentials on the X Developer Portal:
              </p>
              <ol className="list-decimal ml-5 space-y-1">
                <li>
                  Open the{" "}
                  <a
                    href="https://developer.x.com/en/portal/dashboard"
                    target="_blank"
                    rel="noreferrer"
                    className="underline text-foreground inline-flex items-center gap-0.5"
                  >
                    X Developer Portal <ExternalLink className="h-2.5 w-2.5" />
                  </a>{" "}
                  and create or select a Project & App.
                </li>
                <li>
                  In your App settings &gt; <strong>User authentication settings</strong>, set App permissions to{" "}
                  <strong>Read and Write</strong> (or Read, Write, and Direct message).
                </li>
                <li>
                  Under <strong>Keys and tokens</strong>, generate your Consumer Keys (API Key &amp; Secret) and
                  Authentication Tokens (Access Token &amp; Secret).
                </li>
              </ol>
            </div>

            {authMode === "api_keys" ? (
              <div className="grid sm:grid-cols-2 gap-3 pt-2">
                <div className="space-y-1">
                  <Label className="text-xs">API Key (Consumer Key)</Label>
                  <Input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="API key"
                    className="font-mono text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">API Key Secret (Consumer Secret)</Label>
                  <Input
                    type="password"
                    value={apiSecret}
                    onChange={(e) => setApiSecret(e.target.value)}
                    placeholder="API key secret"
                    className="font-mono text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Access Token</Label>
                  <Input
                    type="password"
                    value={oauthToken}
                    onChange={(e) => setOauthToken(e.target.value)}
                    placeholder="Access token"
                    className="font-mono text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Access Token Secret</Label>
                  <Input
                    type="password"
                    value={oauthTokenSecret}
                    onChange={(e) => setOauthTokenSecret(e.target.value)}
                    placeholder="Access token secret"
                    className="font-mono text-xs"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-3 pt-2">
                <div className="space-y-1">
                  <Label className="text-xs">OAuth 2.0 User Access Token</Label>
                  <Input
                    type="password"
                    value={accessToken}
                    onChange={(e) => setAccessToken(e.target.value)}
                    placeholder="Bearer token with tweet.read, tweet.write, users.read"
                    className="font-mono text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Refresh Token (optional)</Label>
                  <Input
                    type="password"
                    value={refreshToken}
                    onChange={(e) => setRefreshToken(e.target.value)}
                    placeholder="Refresh token for offline.access"
                    className="font-mono text-xs"
                  />
                </div>
              </div>
            )}

            <Button
              onClick={onSave}
              disabled={busy}
              className="rounded-none gap-2"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              Connect X Account
            </Button>
          </div>
        )}

        {!loading && status?.connected && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-4 border border-border p-4 bg-muted/10">
              <div className="flex items-center gap-3">
                {status.profileImageUrl ? (
                  <img
                    src={status.profileImageUrl}
                    alt={status.username || "X"}
                    className="h-10 w-10 rounded-full border border-border"
                  />
                ) : (
                  <div className="h-10 w-10 rounded-full bg-foreground text-background flex items-center justify-center font-bold">
                    𝕏
                  </div>
                )}
                <div>
                  <p className="font-semibold text-sm">@{status.username}</p>
                  <p className="text-xs text-muted-foreground font-mono">
                    ID: {status.accountId || "verified"} · Mode: {status.authMode || "api_keys"}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={onSync}
                  disabled={busy}
                  className="rounded-none text-xs gap-1.5"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
                  Sync Mentions
                </Button>
                <Button
                  variant="outline"
                  onClick={onDisconnect}
                  disabled={busy}
                  className="rounded-none text-xs gap-1.5 text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Disconnect
                </Button>
              </div>
            </div>

            {/* Test Tweet Card */}
            <div className="border border-border p-4 space-y-3 bg-muted/5">
              <Label className="text-xs uppercase font-mono tracking-wider">
                Publish a quick live post to X
              </Label>
              <div className="flex gap-2">
                <Input
                  value={testTweetText}
                  onChange={(e) => setTestTweetText(e.target.value)}
                  placeholder="Testing Pippzo autonomous agent on X..."
                  maxLength={280}
                  className="text-xs"
                />
                <Button
                  onClick={onSendTest}
                  disabled={sendingTest || !testTweetText.trim()}
                  className="rounded-none shrink-0 gap-1.5"
                >
                  {sendingTest ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  Post
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Remaining characters: {280 - testTweetText.length} / 280
              </p>
            </div>
          </div>
        )}
      </div>
    </SectionDisclosure>
  );
}
