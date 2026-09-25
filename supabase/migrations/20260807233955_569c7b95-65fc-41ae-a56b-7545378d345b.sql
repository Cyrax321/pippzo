CREATE TABLE public.engagement_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'unipile',
  external_account_id text NOT NULL,
  network text NOT NULL,
  name text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'ok',
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, provider, external_account_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.engagement_accounts TO authenticated;
GRANT ALL ON public.engagement_accounts TO service_role;
ALTER TABLE public.engagement_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members manage engagement accounts" ON public.engagement_accounts
  FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
CREATE TRIGGER engagement_accounts_updated_at BEFORE UPDATE ON public.engagement_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.engagement_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'unipile',
  external_account_id text NOT NULL DEFAULT '',
  network text NOT NULL DEFAULT '',
  kind text NOT NULL DEFAULT 'comment',
  external_id text NOT NULL,
  thread_id text,
  post_id text,
  post_excerpt text,
  permalink text,
  author_name text NOT NULL DEFAULT '',
  author_handle text,
  author_url text,
  author_avatar_url text,
  text text NOT NULL DEFAULT '',
  occurred_at timestamptz,
  sentiment text,
  intent text,
  urgency text,
  should_reply boolean,
  classification jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'new',
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, provider, external_id)
);

CREATE INDEX engagement_items_ws_status_idx ON public.engagement_items (workspace_id, status, occurred_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.engagement_items TO authenticated;
GRANT ALL ON public.engagement_items TO service_role;
ALTER TABLE public.engagement_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members manage engagement items" ON public.engagement_items
  FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
CREATE TRIGGER engagement_items_updated_at BEFORE UPDATE ON public.engagement_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.engagement_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.engagement_items(id) ON DELETE CASCADE,
  text text NOT NULL DEFAULT '',
  mode text NOT NULL DEFAULT 'draft',
  status text NOT NULL DEFAULT 'draft',
  sent_at timestamptz,
  external_id text,
  error text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX engagement_replies_item_idx ON public.engagement_replies (item_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.engagement_replies TO authenticated;
GRANT ALL ON public.engagement_replies TO service_role;
ALTER TABLE public.engagement_replies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members manage engagement replies" ON public.engagement_replies
  FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
CREATE TRIGGER engagement_replies_updated_at BEFORE UPDATE ON public.engagement_replies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS engagement_reply_mode text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS engagement_safe_categories text[] NOT NULL DEFAULT ARRAY['praise']::text[],
  ADD COLUMN IF NOT EXISTS engagement_daily_limit integer NOT NULL DEFAULT 10;

ALTER TABLE public.notification_settings
  ADD COLUMN IF NOT EXISTS on_negative boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS on_opportunity boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS on_support boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS on_dm boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS on_engagement_digest boolean NOT NULL DEFAULT true;