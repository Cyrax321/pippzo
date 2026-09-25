CREATE TABLE public.post_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  buffer_post_id text NOT NULL,
  channel_id text,
  service text,
  text text NOT NULL DEFAULT '',
  media_type text,
  sent_at timestamptz,
  impressions integer NOT NULL DEFAULT 0,
  reach integer NOT NULL DEFAULT 0,
  likes integer NOT NULL DEFAULT 0,
  comments integer NOT NULL DEFAULT 0,
  shares integer NOT NULL DEFAULT 0,
  clicks integer NOT NULL DEFAULT 0,
  engagement_rate numeric NOT NULL DEFAULT 0,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, buffer_post_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.post_metrics TO authenticated;
GRANT ALL ON public.post_metrics TO service_role;

ALTER TABLE public.post_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members read post metrics" ON public.post_metrics
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "members write post metrics" ON public.post_metrics
  FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));

CREATE INDEX post_metrics_ws_sent_idx ON public.post_metrics (workspace_id, sent_at DESC);