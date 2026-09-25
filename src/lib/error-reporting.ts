// Client-side error reporting.
//
// This used to hand exceptions to a hosted preview harness via an injected
// global. Self-hosted there is no such collector, so errors go
// to the console with the route attached — enough to debug locally, and an
// obvious single place to wire up Sentry or similar later.

export function reportClientError(error: unknown, context: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  console.error("[client-error]", {
    route: window.location.pathname,
    ...context,
    error,
  });
}
