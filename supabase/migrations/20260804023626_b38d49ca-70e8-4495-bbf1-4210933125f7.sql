CREATE TABLE IF NOT EXISTS public.image_providers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('openai','gemini')),
  label TEXT NOT NULL,
  api_key TEXT NOT NULL,
  base_url TEXT,
  default_model TEXT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.image_providers TO authenticated;
GRANT ALL ON public.image_providers TO service_role;

ALTER TABLE public.image_providers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read image providers"
  ON public.image_providers FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));

CREATE POLICY "Members can insert image providers"
  ON public.image_providers FOR INSERT TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));

CREATE POLICY "Members can update image providers"
  ON public.image_providers FOR UPDATE TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));

CREATE POLICY "Members can delete image providers"
  ON public.image_providers FOR DELETE TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));

CREATE TRIGGER image_providers_set_updated_at
  BEFORE UPDATE ON public.image_providers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS image_providers_workspace_idx ON public.image_providers(workspace_id);