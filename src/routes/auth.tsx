import { APP_NAME } from "@/lib/app-config";
import { Logo } from "@/components/logo";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { requestPasswordResetOtp } from "@/lib/auth-otp.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Loader2, KeyRound, ArrowLeft, RefreshCw, CheckCircle2, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Sign in · Pippzo" }] }),
  component: AuthPage,
});

const googleEnabled = import.meta.env.VITE_ENABLE_GOOGLE_AUTH === "true";

type AuthMode = "signin" | "signup" | "forgot" | "otp" | "reset";

function AuthPage() {
  const navigate = useNavigate();
  const requestPasswordResetOtpFn = useServerFn(requestPasswordResetOtp);
  const [mode, setMode] = useState<AuthMode>(() =>
    // A password-reset link lands here with `type=recovery` in the URL hash.
    // supabase-js detects that itself and establishes a temporary "recovery"
    // session, which switches straight to the "set a new password" step.
    typeof window !== "undefined" && window.location.hash.includes("type=recovery")
      ? "reset"
      : "signin",
  );

  const [rememberMe, setRememberMe] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("sm.remember_login:enabled") !== "false";
  });

  const [email, setEmail] = useState(() => {
    if (typeof window === "undefined") return "";
    const remember = localStorage.getItem("sm.remember_login:enabled") !== "false";
    if (remember) {
      return localStorage.getItem("sm.remember_login:identifier") || "";
    }
    return "";
  });
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [otp, setOtp] = useState("");
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  // Timer for resend OTP cooldown
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((c) => Math.max(0, c - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  // Auth state change handler
  useEffect(() => {
    let unsub = () => {};
    (async () => {
      const isRecovery = window.location.hash.includes("type=recovery");
      const { data: sub } = supabase.auth.onAuthStateChange((event) => {
        if (event === "PASSWORD_RECOVERY") {
          setMode("reset");
        }
      });
      unsub = () => sub.subscription.unsubscribe();

      if (!isRecovery && mode === "signin") {
        const { data } = await supabase.auth.getSession();
        if (data?.session) {
          window.location.href = "/chat";
        }
      }
    })();
    return () => unsub();
  }, [navigate, mode]);

  // Handles standard Sign In and Sign Up
  const handleEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawIdentifier = email.trim();
    if (!rawIdentifier) {
      toast.error(mode === "signup" ? "Please enter an email address." : "Please enter your email or username.");
      return;
    }
    setLoading(true);

    try {
      if (mode === "signup") {
        const cleanEmail = rawIdentifier.toLowerCase();
        const { data, error } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/onboarding`,
            data: { full_name: name.trim() },
          },
        });
        if (error) throw error;

        if (data.session) {
          toast.success("Account created successfully! Welcome to Pippzo.");
          window.location.href = "/onboarding";
        } else {
          toast.success("Check your email for confirmation, then sign in.");
          setMode("signin");
          setLoading(false);
        }
      } else {
        // Sign In: supports both direct email and username lookup
        let targetEmail = rawIdentifier.toLowerCase();
        if (!targetEmail.includes("@")) {
          try {
            const resp = await fetch("/api/public/resolve-identifier", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ identifier: rawIdentifier }),
            });
            if (resp.ok) {
              const resJson = await resp.json();
              if (resJson?.email) {
                targetEmail = resJson.email;
              }
            }
          } catch {
            // fallback to rawIdentifier
          }
        }

        const { data, error } = await supabase.auth.signInWithPassword({
          email: targetEmail,
          password,
        });

        if (error) {
          if (error.message.toLowerCase().includes("invalid login credentials")) {
            throw new Error("Incorrect email/username or password. Please check your credentials or reset your password.");
          }
          throw error;
        }

        // Save or remove remembered identifier
        try {
          if (rememberMe) {
            localStorage.setItem("sm.remember_login:enabled", "true");
            localStorage.setItem("sm.remember_login:identifier", rawIdentifier);
          } else {
            localStorage.setItem("sm.remember_login:enabled", "false");
            localStorage.removeItem("sm.remember_login:identifier");
          }
        } catch {
          /* ignore storage errors */
        }

        toast.success("Signed in successfully!");
        setLoading(false);
        try {
          await navigate({ to: "/chat" });
        } catch {
          window.location.href = "/chat";
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Authentication failed");
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

  // Step 1: Send OTP to email
  const handleSendOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      toast.error("Please enter your email address.");
      return;
    }

    setLoading(true);
    try {
      // Generate OTP server-side via Supabase Admin (generates a valid recovery token without overwriting)
      const res = await requestPasswordResetOtpFn({ data: { email: cleanEmail } });

      if (res.devOtp) {
        setDevOtp(res.devOtp);
      }

      setMode("otp");
      setResendCooldown(30);
      toast.success(`Verification code generated for ${cleanEmail}!`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send verification code");
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Verify OTP and set new password
  const handleVerifyOtpAndReset = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    const cleanOtp = otp.trim();

    if (!cleanOtp || cleanOtp.length < 6) {
      toast.error("Please enter the complete 6-digit verification code.");
      return;
    }
    if (password.length < 8) {
      toast.error("New password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      // Verify OTP with Supabase
      const { data: verifyData, error: verifyError } = await supabase.auth.verifyOtp({
        email: cleanEmail,
        token: cleanOtp,
        type: "recovery",
      });

      if (verifyError) {
        throw new Error(
          verifyError.message.includes("expired")
            ? "Verification code has expired. Please request a new code."
            : "Invalid verification code. Please check your email and try again.",
        );
      }

      // Update password with active recovery session
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;

      toast.success("Password reset successfully! Welcome back.");

      // Check onboarding state and route
      if (verifyData.user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("onboarding_completed")
          .eq("id", verifyData.user.id)
          .maybeSingle();

        if (profile?.onboarding_completed) {
          navigate({ to: "/chat" });
        } else {
          navigate({ to: "/onboarding" });
        }
      } else {
        navigate({ to: "/chat" });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reset password");
    } finally {
      setLoading(false);
    }
  };

  // Direct recovery link click handler (when #type=recovery in URL)
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("Passwords don't match.");
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("Password updated successfully. Redirecting…");
      navigate({ to: "/chat" });
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
          <Link to="/" className="inline-flex items-center gap-3 justify-center group mb-1">
            <Logo size="lg" />
            <span className="font-serif text-3xl font-bold tracking-tight text-foreground group-hover:opacity-85 transition-opacity">
              pipzo
            </span>
          </Link>
          <h1 className="font-serif text-3xl">
            {mode === "signup"
              ? "Create your account"
              : mode === "forgot"
                ? "Forgot password"
                : mode === "otp"
                  ? "Enter verification code"
                  : mode === "reset"
                    ? "Set a new password"
                    : "Sign in"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {mode === "signup"
              ? "Set up your studio."
              : mode === "forgot"
                ? "We'll send a 6-digit OTP code to your email."
                : mode === "otp"
                  ? `Enter the code sent to ${email}.`
                  : mode === "reset"
                    ? "Choose a new password for your account."
                    : "Welcome back."}
          </p>
        </div>

        {/* Google OAuth (if enabled) */}
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

        {/* Sign In & Sign Up Form */}
        {(mode === "signin" || mode === "signup") && (
          <form onSubmit={handleEmail} className="space-y-4">
            {mode === "signup" && (
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  required
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">{mode === "signup" ? "Email" : "Email or Username"}</Label>
              <Input
                id="email"
                type={mode === "signup" ? "email" : "text"}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={mode === "signup" ? "name@example.com" : "name@example.com or username"}
                autoComplete={mode === "signup" ? "email" : "username"}
                required
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                {mode === "signin" && (
                  <button
                    type="button"
                    onClick={() => {
                      setDevOtp(null);
                      setMode("forgot");
                    }}
                    className="text-xs underline text-muted-foreground hover:text-foreground transition-colors"
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
                placeholder="••••••••"
                required
              />
            </div>
            {mode === "signin" && (
              <div className="flex items-center space-x-2 pt-0.5">
                <Checkbox
                  id="remember-me"
                  checked={rememberMe}
                  onCheckedChange={(checked) => setRememberMe(!!checked)}
                />
                <Label
                  htmlFor="remember-me"
                  className="text-xs text-muted-foreground cursor-pointer select-none font-normal"
                >
                  Remember me
                </Label>
              </div>
            )}
            <Button type="submit" disabled={loading} className="w-full rounded-none">
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : mode === "signup" ? (
                "Create account"
              ) : (
                "Sign in"
              )}
            </Button>
            {import.meta.env.DEV && mode === "signin" && (
              <div className="bg-muted/40 border border-border/60 rounded p-2.5 text-xs text-muted-foreground space-y-1.5 mt-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-foreground">Local Dev Accounts</span>
                  <span className="text-[10px] text-muted-foreground font-mono">pwd: password123</span>
                </div>
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      setEmail("parthipashok04@gmail.com");
                      setPassword("password123");
                    }}
                    className="text-[11px] font-mono px-2 py-0.5 rounded bg-background border border-border hover:bg-muted text-foreground transition-colors cursor-pointer"
                  >
                    parthipashok04@gmail.com
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEmail("user@example.com");
                      setPassword("password123");
                    }}
                    className="text-[11px] font-mono px-2 py-0.5 rounded bg-background border border-border hover:bg-muted text-foreground transition-colors cursor-pointer"
                  >
                    user@example.com
                  </button>
                </div>
              </div>
            )}
          </form>
        )}

        {/* Forgot Password - Step 1: Request OTP */}
        {mode === "forgot" && (
          <form onSubmit={handleSendOtp} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="reset-email">Your email address</Label>
              <Input
                id="reset-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                required
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                You'll receive a 6-digit OTP code to verify your identity and set a new password.
              </p>
            </div>
            <Button type="submit" disabled={loading} className="w-full rounded-none gap-2">
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <KeyRound className="h-4 w-4" /> Send OTP code
                </>
              )}
            </Button>
          </form>
        )}

        {/* Forgot Password - Step 2: Enter OTP & New Password */}
        {mode === "otp" && (
          <form onSubmit={handleVerifyOtpAndReset} className="space-y-4">
            {/* Dev helper badge for instant local testing */}
            {devOtp && (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded p-2.5 text-xs text-amber-700 dark:text-amber-400 space-y-1">
                <div className="flex items-center gap-1.5 font-medium">
                  <ShieldCheck className="h-3.5 w-3.5" /> Dev OTP Code:
                  <span className="font-mono text-sm tracking-widest font-bold underline cursor-pointer" onClick={() => setOtp(devOtp)}>
                    {devOtp}
                  </span>
                  <span className="text-[10px] text-muted-foreground ml-auto">(click to autofill)</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Also available in local mail catcher at <a href="http://127.0.0.1:54324" target="_blank" rel="noreferrer" className="underline">http://127.0.0.1:54324</a>
                </p>
              </div>
            )}

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="otp-input">6-digit OTP Code</Label>
                <button
                  type="button"
                  onClick={() => setMode("forgot")}
                  className="text-xs text-muted-foreground underline hover:text-foreground"
                >
                  Change email
                </button>
              </div>
              <Input
                id="otp-input"
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                placeholder="000000"
                className="font-mono text-center text-lg tracking-[0.35em] h-11 uppercase"
                required
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="confirm-password">Confirm new password</Label>
              <Input
                id="confirm-password"
                type="password"
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat new password"
                required
              />
            </div>

            <Button type="submit" disabled={loading} className="w-full rounded-none gap-2">
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" /> Reset password &amp; sign in
                </>
              )}
            </Button>

            <div className="text-center pt-1">
              <button
                type="button"
                disabled={loading || resendCooldown > 0}
                onClick={() => handleSendOtp()}
                className={`text-xs inline-flex items-center gap-1 ${
                  resendCooldown > 0
                    ? "text-muted-foreground cursor-not-allowed"
                    : "text-foreground underline hover:text-foreground/80 cursor-pointer"
                }`}
              >
                <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
                {resendCooldown > 0
                  ? `Resend code in ${resendCooldown}s`
                  : "Didn't receive the code? Resend OTP"}
              </button>
            </div>
          </form>
        )}

        {/* Direct Email Link Reset (when landed via email link hash) */}
        {mode === "reset" && (
          <form onSubmit={handleResetPassword} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="direct-new-password">New password</Label>
              <Input
                id="direct-new-password"
                type="password"
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                required
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="direct-confirm-password">Confirm new password</Label>
              <Input
                id="direct-confirm-password"
                type="password"
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat new password"
                required
              />
            </div>
            <Button type="submit" disabled={loading} className="w-full rounded-none">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Update password"}
            </Button>
          </form>
        )}

        {/* Footer navigation switches */}
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

        {(mode === "forgot" || mode === "otp" || mode === "reset") && (
          <p className="text-center text-sm text-muted-foreground">
            <button
              type="button"
              onClick={() => {
                setDevOtp(null);
                setMode("signin");
              }}
              className="inline-flex items-center gap-1 underline font-medium text-foreground"
            >
              <ArrowLeft className="h-3 w-3" /> Back to sign in
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
