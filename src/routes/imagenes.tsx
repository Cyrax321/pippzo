import { createFileRoute, redirect } from "@tanstack/react-router";

// Legacy path — the library moved to /library. Keep this route redirecting so
// existing bookmarks and old in-app links still work.
export const Route = createFileRoute("/imagenes")({
  beforeLoad: () => {
    throw redirect({ to: "/library" });
  },
  component: () => null,
});
