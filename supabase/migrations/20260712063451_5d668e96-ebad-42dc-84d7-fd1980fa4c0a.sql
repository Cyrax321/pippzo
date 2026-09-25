-- 1) brand_images: add video support
ALTER TABLE public.brand_images
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'image',
  ADD COLUMN IF NOT EXISTS video_url TEXT,
  ADD COLUMN IF NOT EXISTS poster_url TEXT,
  ADD COLUMN IF NOT EXISTS duration_sec NUMERIC,
  ADD COLUMN IF NOT EXISTS size_bytes BIGINT,
  ADD COLUMN IF NOT EXISTS mime_type TEXT,
  ADD COLUMN IF NOT EXISTS storage_path_video TEXT;

ALTER TABLE public.brand_images
  ADD CONSTRAINT brand_images_kind_check CHECK (kind IN ('image','video'));

-- 2) brand_guideline: visual identity fields
ALTER TABLE public.brand_guideline
  ADD COLUMN IF NOT EXISTS color_palette JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS typography JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS logo_asset_id UUID;

-- 3) video_providers table
CREATE TABLE IF NOT EXISTS public.video_providers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('veo','runway','luma','kling','custom')),
  label TEXT NOT NULL,
  api_key TEXT NOT NULL,
  base_url TEXT,
  default_model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.video_providers TO authenticated;
GRANT ALL ON public.video_providers TO service_role;

ALTER TABLE public.video_providers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read video providers"
  ON public.video_providers FOR SELECT
  TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));

CREATE POLICY "Members can insert video providers"
  ON public.video_providers FOR INSERT
  TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));

CREATE POLICY "Members can update video providers"
  ON public.video_providers FOR UPDATE
  TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));

CREATE POLICY "Members can delete video providers"
  ON public.video_providers FOR DELETE
  TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));

CREATE TRIGGER video_providers_set_updated_at
  BEFORE UPDATE ON public.video_providers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS video_providers_workspace_idx ON public.video_providers(workspace_id);