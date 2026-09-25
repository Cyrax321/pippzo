import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * Verify the incoming request carries a valid Supabase bearer token.
 * Returns the authenticated userId or a Response to short-circuit with 401.
 */
export async function requireAuthFromRequest(
  request: Request,
): Promise<{ userId: string } | { response: Response }> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    console.error("[auth] Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY");
    return { response: new Response("Server misconfigured", { status: 500 }) };
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { response: new Response("Unauthorized", { status: 401 }) };
  }
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token || token.split(".").length !== 3) {
    return { response: new Response("Unauthorized", { status: 401 }) };
  }

  const supabase = createClient<Database>(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims?.sub) {
    return { response: new Response("Unauthorized", { status: 401 }) };
  }
  return { userId: data.claims.sub };
}

/**
 * Supabase client scoped to the caller's bearer token (RLS applies as that
 * user). Use inside API route handlers after `requireAuthFromRequest`.
 */
export function userClientFromRequest(request: Request) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  const token = request.headers.get("authorization")?.slice("Bearer ".length).trim();
  if (!url || !key || !token) return null;
  return createClient<Database>(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}
