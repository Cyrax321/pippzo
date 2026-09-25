import { supabase } from "@/integrations/supabase/client";

/** Returns { Authorization: 'Bearer <token>' } or {} if no session. */
export async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}
