
-- Kill switch
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS automations_enabled boolean NOT NULL DEFAULT true;

-- activity_log
CREATE TABLE public.activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  actor_type text NOT NULL CHECK (actor_type IN ('user','agent','cron','system')),
  actor_id uuid,
  action text NOT NULL,
  summary text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','error')),
  error text,
  related_type text,
  related_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activity_log_ws_created_idx ON public.activity_log (workspace_id, created_at DESC);
CREATE INDEX activity_log_action_idx ON public.activity_log (workspace_id, action);

GRANT SELECT ON public.activity_log TO authenticated;
GRANT ALL ON public.activity_log TO service_role;
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members read activity log" ON public.activity_log
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));

-- cron_jobs
CREATE TABLE public.cron_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  task_type text NOT NULL CHECK (task_type IN ('daily_post','competitor_scan','weekly_report')),
  schedule text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_run_at timestamptz,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cron_jobs_ws_idx ON public.cron_jobs (workspace_id);
CREATE INDEX cron_jobs_due_idx ON public.cron_jobs (enabled, next_run_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cron_jobs TO authenticated;
GRANT ALL ON public.cron_jobs TO service_role;
ALTER TABLE public.cron_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members read cron jobs" ON public.cron_jobs
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "members insert cron jobs" ON public.cron_jobs
  FOR INSERT TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "members update cron jobs" ON public.cron_jobs
  FOR UPDATE TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "members delete cron jobs" ON public.cron_jobs
  FOR DELETE TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));

CREATE TRIGGER cron_jobs_updated_at BEFORE UPDATE ON public.cron_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- cron_runs
CREATE TABLE public.cron_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.cron_jobs(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','ok','error')),
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text
);
CREATE INDEX cron_runs_job_idx ON public.cron_runs (job_id, started_at DESC);
CREATE INDEX cron_runs_ws_idx ON public.cron_runs (workspace_id, started_at DESC);

GRANT SELECT ON public.cron_runs TO authenticated;
GRANT ALL ON public.cron_runs TO service_role;
ALTER TABLE public.cron_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members read cron runs" ON public.cron_runs
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));
