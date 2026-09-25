import { useEffect, type ReactNode } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useWorkspace } from "@/lib/workspace";
import { Loader2 } from "lucide-react";

// "/animation" is the self-contained animation spike: no workspace data, safe to leave open.
const PUBLIC_PATHS = new Set(["/", "/auth", "/onboarding", "/animation"]);

export function AuthGate({ children }: { children: ReactNode }) {
  const { status } = useWorkspace();
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const navigate = useNavigate();
  const isPublic = PUBLIC_PATHS.has(pathname);

  useEffect(() => {
    if (status === "anonymous" && !isPublic) {
      navigate({ to: "/auth" });
    }
  }, [status, isPublic, navigate]);

  if (status === "loading" && !isPublic) {
    return (
      <div className="min-h-screen grid place-items-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return <>{children}</>;
}
