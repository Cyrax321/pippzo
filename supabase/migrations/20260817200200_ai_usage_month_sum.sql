-- Month-to-date AI token usage, summed in the database. The application used
-- to fetch up to 5000 activity_log rows and sum client-side, which silently
-- stopped enforcing the monthly cap once a workspace logged more rows than
-- that in a month. SECURITY DEFINER so the authenticated meter UI can read
-- the total without a broad activity_log grant; search_path pinned as usual
-- for definer functions.
CREATE OR REPLACE FUNCTION public.ai_usage_month_total(ws uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM((details->>'totalTokens')::numeric), 0)::bigint
  FROM activity_log
  WHERE workspace_id = ws
    AND action = 'ai.usage'
    AND details ? 'totalTokens'
    AND created_at >= date_trunc('month', now() AT TIME ZONE 'utc');
$$;

REVOKE ALL ON FUNCTION public.ai_usage_month_total(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ai_usage_month_total(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.ai_usage_month_total(uuid) TO authenticated, service_role;
