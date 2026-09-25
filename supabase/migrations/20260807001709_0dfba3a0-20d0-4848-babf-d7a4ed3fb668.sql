-- LLM providers (bring-your-own text model keys)
CREATE TABLE public.llm_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider text NOT NULL,
  label text NOT NULL,
  api_key text NOT NULL DEFAULT '',
  api_key_enc text,
  base_url text,
  default_model text,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.llm_providers TO authenticated;
GRANT ALL ON public.llm_providers TO service_role;
ALTER TABLE public.llm_providers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can read llm providers" ON public.llm_providers FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "Members can insert llm providers" ON public.llm_providers FOR INSERT TO authenticated WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "Members can update llm providers" ON public.llm_providers FOR UPDATE TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid())) WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "Members can delete llm providers" ON public.llm_providers FOR DELETE TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE TRIGGER llm_providers_set_updated_at BEFORE UPDATE ON public.llm_providers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Non-LLM utility service credentials (Firecrawl, ScrapeCreators, ...)
CREATE TABLE public.service_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  service text NOT NULL,
  label text NOT NULL DEFAULT '',
  api_key text NOT NULL DEFAULT '',
  api_key_enc text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, service)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_credentials TO authenticated;
GRANT ALL ON public.service_credentials TO service_role;
ALTER TABLE public.service_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can read service credentials" ON public.service_credentials FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "Members can insert service credentials" ON public.service_credentials FOR INSERT TO authenticated WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "Members can update service credentials" ON public.service_credentials FOR UPDATE TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid())) WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "Members can delete service credentials" ON public.service_credentials FOR DELETE TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE TRIGGER service_credentials_set_updated_at BEFORE UPDATE ON public.service_credentials FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Workspace playbook overrides (markdown instruction files)
CREATE TABLE public.workspace_playbooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  slug text NOT NULL,
  body text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, slug)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_playbooks TO authenticated;
GRANT ALL ON public.workspace_playbooks TO service_role;
ALTER TABLE public.workspace_playbooks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can read playbooks" ON public.workspace_playbooks FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "Members can insert playbooks" ON public.workspace_playbooks FOR INSERT TO authenticated WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "Members can update playbooks" ON public.workspace_playbooks FOR UPDATE TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid())) WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "Members can delete playbooks" ON public.workspace_playbooks FOR DELETE TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE TRIGGER workspace_playbooks_set_updated_at BEFORE UPDATE ON public.workspace_playbooks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Encrypted-at-rest columns for existing provider tables
ALTER TABLE public.image_providers ADD COLUMN IF NOT EXISTS api_key_enc text;
ALTER TABLE public.video_providers ADD COLUMN IF NOT EXISTS api_key_enc text;

-- Heartbeat + BYO settings on the workspace
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS heartbeat_interval text NOT NULL DEFAULT 'off';
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS heartbeat_last_run_at timestamptz;
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS allow_platform_fallback boolean NOT NULL DEFAULT true;