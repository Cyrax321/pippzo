import { APP_NAME } from "@/lib/app-config";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportClientError } from "../lib/error-reporting";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Toaster } from "@/components/ui/sonner";
import { WorkspaceProvider } from "@/lib/workspace";
import { AuthGate } from "@/components/auth-gate";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="font-serif text-7xl">404</h1>
        <p className="mt-2 text-sm text-muted-foreground">This page does not exist.</p>
        <a
          href="/"
          className="mt-6 inline-flex rounded-md bg-foreground px-4 py-2 text-sm text-background"
        >
          Back to home
        </a>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  useEffect(() => {
    reportClientError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="font-serif text-2xl">Something didn't load</h1>
        <p className="mt-2 text-sm text-muted-foreground">Try again or go back home.</p>
        <div className="mt-6 flex justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="rounded-md bg-foreground px-4 py-2 text-sm text-background"
          >
            Retry
          </button>
          <a href="/" className="rounded-md border border-border px-4 py-2 text-sm">
            Home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Social Studio" },
      { name: "description", content: "Your Social Media Manager" },
      { property: "og:title", content: "Social Studio" },
      { name: "twitter:title", content: "Social Studio" },
      { property: "og:description", content: "Your Social Media Manager" },
      { name: "twitter:description", content: "Your Social Media Manager" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const chromeless = pathname === "/auth" || pathname === "/onboarding";

  return (
    <QueryClientProvider client={queryClient}>
      <WorkspaceProvider>
        <AuthGate>
          {chromeless ? (
            <Outlet />
          ) : (
            <SidebarProvider>
              <div className="paper min-h-screen flex w-full bg-background relative">
                <AppSidebar />
                <div className="flex-1 flex flex-col min-w-0 relative z-[1]">
                  <header className="h-12 flex items-center justify-between border-b border-border px-3 sticky top-0 bg-background/85 backdrop-blur z-10">
                    <div className="flex items-center gap-3">
                      <SidebarTrigger />
                      <span className="label-eyebrow hidden sm:inline">{APP_NAME}</span>
                    </div>
                  </header>
                  <main className="flex-1 min-w-0">
                    <Outlet />
                  </main>
                </div>
              </div>
              <Toaster />
            </SidebarProvider>
          )}
        </AuthGate>
        <Toaster />
      </WorkspaceProvider>
    </QueryClientProvider>
  );
}
