-- Restrict workspace_members INSERT to workspace owners only
DROP POLICY IF EXISTS "members insert by owner or self" ON public.workspace_members;
CREATE POLICY "members insert by owner"
  ON public.workspace_members
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_workspace_owner(workspace_id, auth.uid()));

-- Revoke EXECUTE from authenticated/anon/public on SECURITY DEFINER helpers
REVOKE EXECUTE ON FUNCTION public.is_workspace_member(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_workspace_owner(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;