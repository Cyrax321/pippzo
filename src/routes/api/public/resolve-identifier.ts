import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/resolve-identifier")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.json();
          const identifier = typeof body?.identifier === "string" ? body.identifier.trim() : "";
          if (!identifier) {
            return Response.json({ email: "" });
          }
          if (identifier.includes("@")) {
            return Response.json({ email: identifier.toLowerCase() });
          }

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const filter = `email.ilike.${identifier}@%,full_name.ilike.%${identifier}%`;
          const { data, error } = await supabaseAdmin
            .from("profiles")
            .select("email")
            .or(filter)
            .limit(1);

          if (!error && data && data.length > 0 && data[0]?.email) {
            return Response.json({ email: data[0].email.toLowerCase() });
          }
          return Response.json({ email: identifier.toLowerCase() });
        } catch (e) {
          console.warn("[resolve-identifier] error:", e);
          return Response.json({ email: "" });
        }
      },
    },
  },
});
