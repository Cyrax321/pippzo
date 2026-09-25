-- activity_log fixes:
-- 1) The INSERT RLS policy ("members insert activity log", 20260710043036)
--    existed but the table-level INSERT privilege was never granted in
--    20260710042923 (SELECT only), so on a fresh deploy every browser-session
--    insert fails with 42501 and the log entry is silently dropped.
-- 2) heartbeat.server.ts writes status 'warning' when something needs the
--    human's attention, but the original CHECK only allowed ('ok','error'),
--    so the DB rejected every warning heartbeat row.

GRANT INSERT ON public.activity_log TO authenticated;

ALTER TABLE public.activity_log DROP CONSTRAINT IF EXISTS activity_log_status_check;
ALTER TABLE public.activity_log
  ADD CONSTRAINT activity_log_status_check CHECK (status IN ('ok', 'error', 'warning'));
