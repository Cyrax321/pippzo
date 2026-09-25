CREATE TABLE public.agent_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'lesson',
  content text NOT NULL,
  weight numeric NOT NULL DEFAULT 1,
  source text,
  tags text[] NOT NULL DEFAULT '{}',
  related_type text,
  related_id text,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX agent_memory_ws_idx ON public.agent_memory (workspace_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_memory TO authenticated;
GRANT ALL ON public.agent_memory TO service_role;

ALTER TABLE public.agent_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members read agent memory" ON public.agent_memory
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "members insert agent memory" ON public.agent_memory
  FOR INSERT TO authenticated WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "members update agent memory" ON public.agent_memory
  FOR UPDATE TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid())) WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "members delete agent memory" ON public.agent_memory
  FOR DELETE TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));

CREATE TRIGGER agent_memory_set_updated_at BEFORE UPDATE ON public.agent_memory
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();