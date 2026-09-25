
-- =====================================================================
-- updated_at helper
-- =====================================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- =====================================================================
-- profiles
-- =====================================================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  avatar_url TEXT,
  onboarding_completed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles self read" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "profiles self upsert" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles self update" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================================
-- workspaces
-- =====================================================================
CREATE TABLE public.workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspaces TO authenticated;
GRANT ALL ON public.workspaces TO service_role;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER workspaces_updated_at BEFORE UPDATE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TYPE public.workspace_role AS ENUM ('owner', 'admin', 'editor', 'viewer');

CREATE TABLE public.workspace_members (
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.workspace_role NOT NULL DEFAULT 'editor',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_members TO authenticated;
GRANT ALL ON public.workspace_members TO service_role;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;

-- Security-definer helper to avoid recursive RLS between workspaces and members
CREATE OR REPLACE FUNCTION public.is_workspace_member(_workspace_id UUID, _user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = _workspace_id AND user_id = _user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.is_workspace_owner(_workspace_id UUID, _user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspaces
    WHERE id = _workspace_id AND owner_id = _user_id
  );
$$;

-- Workspaces policies
CREATE POLICY "workspaces visible to members" ON public.workspaces
  FOR SELECT USING (public.is_workspace_member(id, auth.uid()) OR owner_id = auth.uid());
CREATE POLICY "workspaces insert by owner" ON public.workspaces
  FOR INSERT WITH CHECK (owner_id = auth.uid());
CREATE POLICY "workspaces update by owner" ON public.workspaces
  FOR UPDATE USING (owner_id = auth.uid());
CREATE POLICY "workspaces delete by owner" ON public.workspaces
  FOR DELETE USING (owner_id = auth.uid());

-- Members policies
CREATE POLICY "members self read" ON public.workspace_members
  FOR SELECT USING (user_id = auth.uid() OR public.is_workspace_owner(workspace_id, auth.uid()));
CREATE POLICY "members insert by owner or self" ON public.workspace_members
  FOR INSERT WITH CHECK (
    public.is_workspace_owner(workspace_id, auth.uid()) OR user_id = auth.uid()
  );
CREATE POLICY "members update by owner" ON public.workspace_members
  FOR UPDATE USING (public.is_workspace_owner(workspace_id, auth.uid()));
CREATE POLICY "members delete by owner or self" ON public.workspace_members
  FOR DELETE USING (
    public.is_workspace_owner(workspace_id, auth.uid()) OR user_id = auth.uid()
  );

-- =====================================================================
-- Auto-create profile + personal workspace on user signup
-- =====================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ws_id UUID;
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.workspaces (name, owner_id)
  VALUES ('Personal workspace', NEW.id)
  RETURNING id INTO ws_id;

  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (ws_id, NEW.id, 'owner');

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =====================================================================
-- brand_profile (1 row per workspace)
-- =====================================================================
CREATE TABLE public.brand_profile (
  workspace_id UUID PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  socials TEXT NOT NULL DEFAULT '',
  industry TEXT NOT NULL DEFAULT '',
  audience TEXT NOT NULL DEFAULT '',
  products_services TEXT NOT NULL DEFAULT '',
  tone_notes TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brand_profile TO authenticated;
GRANT ALL ON public.brand_profile TO service_role;
ALTER TABLE public.brand_profile ENABLE ROW LEVEL SECURITY;
CREATE POLICY "brand_profile members all" ON public.brand_profile
  FOR ALL USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
CREATE TRIGGER brand_profile_updated_at BEFORE UPDATE ON public.brand_profile
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================================
-- brand_guideline (1 row per workspace)
-- =====================================================================
CREATE TABLE public.brand_guideline (
  workspace_id UUID PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  personality TEXT NOT NULL DEFAULT '',
  tone_of_voice TEXT NOT NULL DEFAULT '',
  writing_style TEXT NOT NULL DEFAULT '',
  vocabulary_use TEXT[] NOT NULL DEFAULT '{}',
  vocabulary_avoid TEXT[] NOT NULL DEFAULT '{}',
  content_pillars TEXT[] NOT NULL DEFAULT '{}',
  audience_profile TEXT NOT NULL DEFAULT '',
  recurring_themes TEXT[] NOT NULL DEFAULT '{}',
  preferred_ctas TEXT[] NOT NULL DEFAULT '{}',
  do_examples TEXT[] NOT NULL DEFAULT '{}',
  dont_examples TEXT[] NOT NULL DEFAULT '{}',
  visual_direction TEXT NOT NULL DEFAULT '',
  hashtag_style TEXT NOT NULL DEFAULT '',
  platform_guidance TEXT NOT NULL DEFAULT '',
  emotional_tone TEXT NOT NULL DEFAULT '',
  custom_instructions TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brand_guideline TO authenticated;
GRANT ALL ON public.brand_guideline TO service_role;
ALTER TABLE public.brand_guideline ENABLE ROW LEVEL SECURITY;
CREATE POLICY "brand_guideline members all" ON public.brand_guideline
  FOR ALL USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
CREATE TRIGGER brand_guideline_updated_at BEFORE UPDATE ON public.brand_guideline
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================================
-- brand_images
-- =====================================================================
CREATE TABLE public.brand_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  storage_path TEXT,
  url TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  approved BOOLEAN NOT NULL DEFAULT false,
  analysis TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brand_images TO authenticated;
GRANT ALL ON public.brand_images TO service_role;
ALTER TABLE public.brand_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY "brand_images members all" ON public.brand_images
  FOR ALL USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
CREATE INDEX brand_images_workspace_idx ON public.brand_images (workspace_id, created_at DESC);

-- =====================================================================
-- competitors
-- =====================================================================
CREATE TABLE public.competitors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  website TEXT,
  socials JSONB NOT NULL DEFAULT '{}'::jsonb,
  snapshot JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.competitors TO authenticated;
GRANT ALL ON public.competitors TO service_role;
ALTER TABLE public.competitors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "competitors members all" ON public.competitors
  FOR ALL USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
CREATE INDEX competitors_workspace_idx ON public.competitors (workspace_id, created_at DESC);

-- =====================================================================
-- scheduled_posts
-- =====================================================================
CREATE TABLE public.scheduled_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  post JSONB NOT NULL,
  image_url TEXT,
  image_storage_path TEXT,
  scheduled_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'draft',
  note TEXT,
  buffer_id TEXT,
  buffer_channel_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scheduled_posts TO authenticated;
GRANT ALL ON public.scheduled_posts TO service_role;
ALTER TABLE public.scheduled_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "scheduled_posts members all" ON public.scheduled_posts
  FOR ALL USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
CREATE INDEX scheduled_posts_workspace_idx ON public.scheduled_posts (workspace_id, scheduled_at);

-- =====================================================================
-- generated_images (chat-generated, before attaching to a post)
-- =====================================================================
CREATE TABLE public.generated_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  prompt TEXT,
  storage_path TEXT,
  url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.generated_images TO authenticated;
GRANT ALL ON public.generated_images TO service_role;
ALTER TABLE public.generated_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY "generated_images members all" ON public.generated_images
  FOR ALL USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));

-- =====================================================================
-- buffer_connection (per workspace; token stored encrypted-at-rest by PG)
-- =====================================================================
CREATE TABLE public.buffer_connection (
  workspace_id UUID PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  channels JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.buffer_connection TO authenticated;
GRANT ALL ON public.buffer_connection TO service_role;
ALTER TABLE public.buffer_connection ENABLE ROW LEVEL SECURITY;
-- Only workspace owners can view/manage the token (admins can read)
CREATE POLICY "buffer_connection owners all" ON public.buffer_connection
  FOR ALL USING (public.is_workspace_owner(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_owner(workspace_id, auth.uid()));
CREATE TRIGGER buffer_connection_updated_at BEFORE UPDATE ON public.buffer_connection
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
