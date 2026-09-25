import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { hasLegacyData, importLegacyData } from "@/lib/legacy-import";
import { useWorkspace } from "@/lib/workspace";

export const Route = createFileRoute("/onboarding")({
  head: () => ({ meta: [{ title: "Welcome · Social Studio" }] }),
  component: OnboardingPage,
});

function OnboardingPage() {
  const navigate = useNavigate();
  const { user, workspaces, activeWorkspaceId, status, refreshWorkspaces } = useWorkspace();
  const [fullName, setFullName] = useState("");
  const [workspaceName, setWorkspaceName] = useState("Personal workspace");
  const [importing, setImporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [legacy, setLegacy] = useState(false);
  const [skipped, setSkipped] = useState(false);

  useEffect(() => {
    if (status === "anonymous") navigate({ to: "/auth" });
  }, [status, navigate]);

  useEffect(() => {
    if (user) setFullName((user.user_metadata?.full_name as string) ?? "");
  }, [user]);

  useEffect(() => {
    const first = workspaces[0];
    if (first) setWorkspaceName(first.name);
  }, [workspaces]);

  useEffect(() => {
    setLegacy(hasLegacyData());
  }, []);

  // Skip onboarding if already completed and no legacy data to import.
  useEffect(() => {
    (async () => {
      if (skipped || !user || status !== "ready") return;
      const { data } = await supabase
        .from("profiles")
        .select("onboarding_completed")
        .eq("id", user.id)
        .maybeSingle();
      if (data?.onboarding_completed && !hasLegacyData()) {
        setSkipped(true);
        navigate({ to: "/chat" });
      }
    })();
  }, [user, status, navigate, skipped]);

  const handleImport = async () => {
    setImporting(true);
    try {
      const s = await importLegacyData();
      toast.success(
        `Imported: ${s.images} images, ${s.posts} posts, ${s.competitors} competitors.`,
      );
      setLegacy(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const handleFinish = async () => {
    if (!user) return;
    setSaving(true);
    try {
      if (fullName.trim()) {
        await supabase.from("profiles").upsert({
          id: user.id,
          email: user.email,
          full_name: fullName,
          onboarding_completed: true,
        });
      } else {
        await supabase
          .from("profiles")
          .upsert({ id: user.id, email: user.email, onboarding_completed: true });
      }
      const ws = workspaces.find((w) => w.id === activeWorkspaceId);
      if (ws && workspaceName.trim() && workspaceName !== ws.name) {
        await supabase.from("workspaces").update({ name: workspaceName.trim() }).eq("id", ws.id);
        await refreshWorkspaces();
      }
      navigate({ to: "/chat" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  if (status !== "ready") {
    return (
      <div className="min-h-screen grid place-items-center">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background px-4 py-12">
      <div className="max-w-lg mx-auto space-y-8">
        <header className="text-center space-y-2">
          <div className="h-12 w-12 mx-auto border border-foreground grid place-items-center font-serif text-3xl">
            R
          </div>
          <h1 className="font-serif text-3xl">Welcome to your studio</h1>
          <p className="text-sm text-muted-foreground">A couple of details and you're in.</p>
        </header>

        <section className="space-y-4 border border-border p-6">
          <p className="label-eyebrow">Profile</p>
          <div className="space-y-2">
            <Label htmlFor="name">Your name</Label>
            <Input id="name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ws">Workspace name</Label>
            <Input
              id="ws"
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Your brand, guide, and calendar live inside this workspace. You can invite teammates
              later.
            </p>
          </div>
        </section>

        {legacy && (
          <section className="space-y-3 border border-border p-6">
            <p className="label-eyebrow">Migration</p>
            <p className="text-sm">
              We detected brand/guide/calendar data saved in this browser from before. Import it
              into your new workspace?
            </p>
            <div className="flex gap-2">
              <Button onClick={handleImport} disabled={importing} className="rounded-none">
                {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Import my data"}
              </Button>
              <Button
                variant="outline"
                onClick={() => setLegacy(false)}
                disabled={importing}
                className="rounded-none"
              >
                Skip
              </Button>
            </div>
          </section>
        )}

        <Button onClick={handleFinish} disabled={saving} className="w-full rounded-none">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Enter the studio"}
        </Button>
      </div>
    </div>
  );
}
