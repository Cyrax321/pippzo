-- =====================================================================
-- x_connection: per-workspace X (Twitter) integration
-- Supports OAuth 2.0 PKCE user context & direct API/OAuth 1.0a keys
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.x_connection (
  workspace_id UUID PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  profile_image_url TEXT,
  -- OAuth 2.0 PKCE tokens:
  access_token TEXT NOT NULL DEFAULT '',
  access_token_enc TEXT,
  refresh_token_enc TEXT,
  token_type TEXT DEFAULT 'bearer',
  scope TEXT DEFAULT '',
  expires_at TIMESTAMPTZ,
  -- API Key & OAuth 1.0a credentials:
  api_key_enc TEXT,
  api_secret_enc TEXT,
  oauth_token_enc TEXT,
  oauth_token_secret_enc TEXT,
  bearer_token_enc TEXT,
  client_id_enc TEXT,
  client_secret_enc TEXT,
  auth_mode TEXT NOT NULL DEFAULT 'oauth2',
  status TEXT NOT NULL DEFAULT 'connected',
  rate_limit_info JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.x_connection TO authenticated;
GRANT ALL ON public.x_connection TO service_role;
ALTER TABLE public.x_connection ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "x_connection members all" ON public.x_connection;
CREATE POLICY "x_connection members all" ON public.x_connection
  FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));

DROP TRIGGER IF EXISTS x_connection_updated_at ON public.x_connection;
CREATE TRIGGER x_connection_updated_at BEFORE UPDATE ON public.x_connection
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Add direct X tracking columns to scheduled_posts
ALTER TABLE public.scheduled_posts
  ADD COLUMN IF NOT EXISTS x_post_id TEXT,
  ADD COLUMN IF NOT EXISTS x_posted_at TIMESTAMPTZ;
