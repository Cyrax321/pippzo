import { APP_NAME } from "@/lib/app-config";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Sign in · Pippzo" }] }),
  component: AuthPage,
});

const googleEnabled = import.meta.env.VITE_ENABLE_GOOGLE_AUTH === "true";

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup" | "forgot" | "reset">(() =>
    // A password-reset link lands here with `type=recovery` in the URL hash.
    // supabase-js detects that itself and establishes a temporary "recovery"
    // session, which would otherwise make the effect below redirect straight
    // past the "set a new password" step before the user ever sees it.
    typeof window !== "undefined" && window.location.hash.includes("type=recovery")
      ? "reset"
      : "signin",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let unsub = () => {};
    (async () => {
      const isRecovery = window.location.hash.includes("type=recovery");
      const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
        if (event === "PASSWORD_RECOVERY") {
          setMode("reset");
          return;
        }
        // Checked against the hash directly (not the `mode` state) so this
        // can't fire on a stale closure and navigate away mid-reset.
        if (session && !window.location.hash.includes("type=recovery")) {
          navigate({ to: "/onboarding" });
        }
      });
      unsub = () => sub.subscription.unsubscribe();
      if (!isRecovery) {
        const { data } = await supabase.auth.getSession();
        if (data.session) navigate({ to: "/onboarding" });
      }
    })();
    return () => unsub();
  }, [navigate]);

  const handleEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/onboarding`,
            data: { full_name: name },
          },
        });
        if (error) throw error;
        toast.success("Check your email to confirm your account, then sign in.");
        setMode("signin");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/onboarding` },
      });
      if (error) throw error;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Google sign-in failed");
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      // redirectTo must be on Supabase's allow-list (additional_redirect_urls
      // in supabase/config.toml) or it silently falls back to site_url.
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth`,
      });
      if (error) throw error;
      toast.success(
        "If an account exists for that email, a reset link is on its way. " +
          "Locally, check the mail catcher at http://127.0.0.1:54324.",
      );
      setMode("signin");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send reset email");
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast.error("Passwords don't match");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("Password updated. Redirecting…");
      navigate({ to: "/onboarding" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid place-items-center bg-background px-4 py-10">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center space-y-2">
          <Link to="/" className="inline-block">
            <div className="h-12 w-12 mx-auto border border-foreground grid place-items-center font-serif text-3xl">
              {APP_NAME[0]}
            </div>
          </Link>
          <h1 className="font-serif text-3xl">
            {mode === "signup"
              ? "Create your account"
              : mode === "forgot"
                ? "Reset your password"
                : mode === "reset"
                  ? "Set a new password"
                  : "Sign in"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {mode === "signup"
              ? "Set up your studio."
              : mode === "forgot"
                ? "We'll email you a link to get back in."
                : mode === "reset"
                  ? "Choose a new password for your account."
                  : "Welcome back."}
          </p>
        </div>

        {/* Google needs an OAuth client configured in supabase/config.toml.
            Hidden by default so the button is never shown broken. */}
        {googleEnabled && (mode === "signin" || mode === "signup") && (
          <>
            <Button
              onClick={handleGoogle}
              disabled={loading}
              variant="outline"
              className="w-full rounded-none"
            >
              Continue with Google
            </Button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-background px-2 text-muted-foreground">or with email</span>
              </div>
            </div>
          </>
        )}

        {(mode === "signin" || mode === "signup") && (
          <form onSubmit={handleEmail} className="space-y-4">
            {mode === "signup" && (
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                {mode === "signin" && (
                  <button
                    type="button"
                    onClick={() => setMode("forgot")}
                    className="text-xs underline text-muted-foreground"
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <Input
                id="password"
                type="password"
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" disabled={loading} className="w-full rounded-none">
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : mode === "signup" ? (
                "Create account"
              ) : (
                "Sign in"
              )}
            </Button>
          </form>
        )}

        {mode === "forgot" && (
          <form onSubmit={handleForgotPassword} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="reset-email">Email</Label>
              <Input
                id="reset-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <Button type="submit" disabled={loading} className="w-full rounded-none">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send reset link"}
            </Button>
          </form>
        )}

        {mode === "reset" && (
          <form onSubmit={handleResetPassword} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm new password</Label>
              <Input
                id="confirm-password"
                type="password"
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" disabled={loading} className="w-full rounded-none">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Update password"}
            </Button>
          </form>
        )}

        {(mode === "signin" || mode === "signup") && (
          <p className="text-center text-sm text-muted-foreground">
            {mode === "signup" ? "Already have an account?" : "Don't have an account?"}{" "}
            <button
              type="button"
              onClick={() => setMode(mode === "signup" ? "signin" : "signup")}
              className="underline font-medium text-foreground"
            >
              {mode === "signup" ? "Sign in" : "Sign up"}
            </button>
          </p>
        )}

        {mode === "forgot" && (
          <p className="text-center text-sm text-muted-foreground">
            <button
              type="button"
              onClick={() => setMode("signin")}
              className="underline font-medium text-foreground"
            >
              Back to sign in
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
