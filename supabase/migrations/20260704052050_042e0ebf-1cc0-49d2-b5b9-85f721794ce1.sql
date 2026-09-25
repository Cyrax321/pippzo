
-- Create a private schema not exposed by the Data API
CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

-- Recreate the SECURITY DEFINER helpers inside the private schema
CREATE OR REPLACE FUNCTION private.is_workspace_member(_workspace_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = _workspace_id AND user_id = _user_id
  );
$$;

CREATE OR REPLACE FUNCTION private.is_workspace_owner(_workspace_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspaces
    WHERE id = _workspace_id AND owner_id = _user_id
  );
$$;

REVOKE EXECUTE ON FUNCTION private.is_workspace_member(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.is_workspace_owner(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.is_workspace_member(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_workspace_owner(uuid, uuid) TO authenticated, service_role;

-- Replace the public wrappers with SECURITY INVOKER delegates so the API-exposed
-- functions are no longer SECURITY DEFINER. RLS keeps working transparently.
CREATE OR REPLACE FUNCTION public.is_workspace_member(_workspace_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT private.is_workspace_member(_workspace_id, _user_id);
$$;

CREATE OR REPLACE FUNCTION public.is_workspace_owner(_workspace_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT private.is_workspace_owner(_workspace_id, _user_id);
$$;

GRANT EXECUTE ON FUNCTION public.is_workspace_member(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_workspace_owner(uuid, uuid) TO authenticated, service_role;
