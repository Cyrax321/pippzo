import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  getEngagementConfig,
  saveUnipileCredentials,
  disconnectUnipile,
  createUnipileLink,
  refreshEngagementAccounts,
  removeEngagementAccount,
} from "@/lib/engagement/engagement.functions";
import { networkLabel, type EngagementAccountPublic } from "@/lib/engagement/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { SectionDisclosure } from "@/components/section-disclosure";
import {
  Loader2,
  MessagesSquare,
  Trash2,
  RefreshCw,
  Link2,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";

export function UnipileSection({ workspaceId }: { workspaceId: string | null }) {
  const getConfig = useServerFn(getEngagementConfig);
  const save = useServerFn(saveUnipileCredentials);
  const disconnect = useServerFn(disconnectUnipile);
  const link = useServerFn(createUnipileLink);
  const refresh = useServerFn(refreshEngagementAccounts);
  const removeAccount = useServerFn(removeEngagementAccount);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [dsn, setDsn] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [accounts, setAccounts] = useState<EngagementAccountPublic[]>([]);

  const load = useCallback(() => {
    if (!workspaceId) return;
    setLoading(true);
    setLoadError(null);
    getConfig({ data: { workspaceId } })
      .then((c) => {
        setConnected(c.connected);
        setDsn(c.dsn ?? "");
        setAccounts(c.accounts);
      })
      .catch((e) =>
        setLoadError(e instanceof Error ? e.message : "Could not load engagement settings."),
      )
      .finally(() => setLoading(false));
  }, [workspaceId, getConfig]);

  useEffect(load, [load]);

  const onSave = async () => {
    if (!workspaceId) return;
    setBusy(true);
    try {
      const res = await save({ data: { workspaceId, apiKey: apiKey.trim(), dsn: dsn.trim() } });
      if (!res.ok) throw new Error(res.error);
      setApiKey("");
      setConnected(true);
      toast.success("Unipile connected");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not connect Unipile");
    } finally {
      setBusy(false);
    }
  };

  const onLink = async () => {
    if (!workspaceId) return;
    setBusy(true);
    try {
      const { url } = await link({ data: { workspaceId, origin: window.location.origin } });
      window.open(url, "_blank", "noopener");
      toast.info("Finish linking in the new tab, then hit Refresh.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start the linking flow");
    } finally {
      setBusy(false);
    }
  };

  const onRefresh = async () => {
    if (!workspaceId) return;
    setBusy(true);
    try {
      const { accounts: a } = await refresh({ data: { workspaceId } });
      setAccounts(a);
      toast.success(`${a.length} account${a.length === 1 ? "" : "s"} linked`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not refresh accounts");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionDisclosure
      icon={<MessagesSquare className="h-4 w-4" />}
      title="Engagement (comments & DMs)"
      subtitle="Unipile · bring your own key"
      badge={
        connected ? (
          <span className="label-eyebrow !text-[0.625rem] flex items-center gap-1">
            <CheckCircle2 className="h-3.5 w-3.5" /> {accounts.length} linked
          </span>
        ) : null
      }
    >
      <div className="p-5 space-y-5">
        <p className="text-sm text-muted-foreground">
          Unipile connects your LinkedIn, Instagram and messaging accounts so the agent can read
          comments and DMs — and reply. Buffer does not expose this over its API. Get an API key and
          your DSN from unipile.com → Dashboard → Access tokens.
        </p>

        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : loadError ? (
          <div className="flex items-start justify-between gap-3 text-xs border border-dashed border-destructive/50 px-4 py-3">
            <span className="flex items-start gap-2 text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              Couldn&rsquo;t load engagement settings: {loadError}
            </span>
            <Button variant="ghost" size="sm" className="gap-1.5 shrink-0" onClick={load}>
              <RefreshCw className="h-3.5 w-3.5" /> Retry
            </Button>
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="unipile-dsn">DSN</Label>
                <Input
                  id="unipile-dsn"
                  value={dsn}
                  onChange={(e) => setDsn(e.target.value)}
                  placeholder="api8.unipile.com:13843"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="unipile-key">API key</Label>
                <Input
                  id="unipile-key"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={connected ? "•••••••• (saved)" : "Your Unipile API key"}
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={onSave} disabled={busy || !apiKey.trim() || !dsn.trim()}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {connected ? "Update key" : "Connect Unipile"}
              </Button>
              {connected ? (
                <>
                  <Button variant="outline" onClick={onLink} disabled={busy}>
                    <Link2 className="h-4 w-4" /> Link an account
                  </Button>
                  <Button variant="outline" onClick={onRefresh} disabled={busy}>
                    <RefreshCw className="h-4 w-4" /> Refresh
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={async () => {
                      if (!workspaceId) return;
                      await disconnect({ data: { workspaceId } });
                      setConnected(false);
                      setAccounts([]);
                      toast.success("Unipile disconnected");
                    }}
                    disabled={busy}
                  >
                    Disconnect
                  </Button>
                </>
              ) : null}
            </div>

            {accounts.length ? (
              <ul className="border border-border divide-y divide-border">
                {accounts.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm truncate">{a.name}</p>
                      <p className="label-eyebrow !text-[0.625rem]">
                        {networkLabel(a.network)} · {a.status}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${a.name}`}
                      onClick={async () => {
                        if (!workspaceId) return;
                        const res = await removeAccount({ data: { workspaceId, accountId: a.id } });
                        if (res.ok) {
                          setAccounts((cur) => cur.filter((x) => x.id !== a.id));
                          toast.success("Account removed");
                        } else toast.error(res.error ?? "Could not remove");
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : connected ? (
              <p className="text-sm text-muted-foreground">
                No accounts linked yet. Use “Link an account” to connect LinkedIn or Instagram.
              </p>
            ) : null}
          </>
        )}
      </div>
    </SectionDisclosure>
  );
}
