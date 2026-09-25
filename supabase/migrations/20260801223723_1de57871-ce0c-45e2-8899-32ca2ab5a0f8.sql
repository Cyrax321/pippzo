ALTER TABLE public.cron_jobs DROP CONSTRAINT IF EXISTS cron_jobs_task_type_check;
ALTER TABLE public.cron_jobs ADD CONSTRAINT cron_jobs_task_type_check CHECK (task_type IN ('daily_post','competitor_scan','weekly_report','metrics_sync'));

DROP POLICY IF EXISTS "brand_guideline members all" ON public.brand_guideline;
CREATE POLICY "brand_guideline members all" ON public.brand_guideline FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "brand_images members all" ON public.brand_images;
CREATE POLICY "brand_images members all" ON public.brand_images FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "brand_profile members all" ON public.brand_profile;
CREATE POLICY "brand_profile members all" ON public.brand_profile FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "buffer_connection owners all" ON public.buffer_connection;
CREATE POLICY "buffer_connection owners all" ON public.buffer_connection FOR ALL TO authenticated
  USING (public.is_workspace_owner(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_owner(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "competitors members all" ON public.competitors;
CREATE POLICY "competitors members all" ON public.competitors FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "generated_images members all" ON public.generated_images;
CREATE POLICY "generated_images members all" ON public.generated_images FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "scheduled_posts members all" ON public.scheduled_posts;
CREATE POLICY "scheduled_posts members all" ON public.scheduled_posts FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "profiles self read" ON public.profiles;
CREATE POLICY "profiles self read" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
DROP POLICY IF EXISTS "profiles self upsert" ON public.profiles;
CREATE POLICY "profiles self upsert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS "profiles self update" ON public.profiles;
CREATE POLICY "profiles self update" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "members self read" ON public.workspace_members;
CREATE POLICY "members self read" ON public.workspace_members FOR SELECT TO authenticated
  USING ((user_id = auth.uid()) OR public.is_workspace_owner(workspace_id, auth.uid()));
DROP POLICY IF EXISTS "members update by owner" ON public.workspace_members;
CREATE POLICY "members update by owner" ON public.workspace_members FOR UPDATE TO authenticated
  USING (public.is_workspace_owner(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_owner(workspace_id, auth.uid()));
DROP POLICY IF EXISTS "members delete by owner or self" ON public.workspace_members;
CREATE POLICY "members delete by owner or self" ON public.workspace_members FOR DELETE TO authenticated
  USING (public.is_workspace_owner(workspace_id, auth.uid()) OR (user_id = auth.uid()));

DROP POLICY IF EXISTS "workspaces visible to members" ON public.workspaces;
CREATE POLICY "workspaces visible to members" ON public.workspaces FOR SELECT TO authenticated
  USING (public.is_workspace_member(id, auth.uid()) OR (owner_id = auth.uid()));
DROP POLICY IF EXISTS "workspaces insert by owner" ON public.workspaces;
CREATE POLICY "workspaces insert by owner" ON public.workspaces FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
DROP POLICY IF EXISTS "workspaces update by owner" ON public.workspaces;
CREATE POLICY "workspaces update by owner" ON public.workspaces FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
DROP POLICY IF EXISTS "workspaces delete by owner" ON public.workspaces;
CREATE POLICY "workspaces delete by owner" ON public.workspaces FOR DELETE TO authenticated USING (owner_id = auth.uid());