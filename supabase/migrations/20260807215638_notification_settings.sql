-- Recovers `public.notification_settings`, which is missing from the exported
-- migration history: the very next migration (20260807215639) GRANTs on this
-- table and 20260807233955 ALTERs it, but nothing ever created it, so a fresh
-- database could not be built from these files.
--
-- Shape reconstructed from src/integrations/supabase/types.ts and the columns
-- read/written in src/lib/notifications.functions.ts and notifications.server.ts.
-- The engagement-related flags (on_dm, on_negative, on_opportunity, on_support,
-- on_engagement_digest) are intentionally NOT declared here — 20260807233955
-- adds them, and this migration is deliberately placed before it so the history
-- replays in its original order.
--
-- Guarded with IF NOT EXISTS so it is a no-op against a database where the
-- table already exists.

CREATE TABLE IF NOT EXISTS public.notification_settings (
  workspace_id UUID PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  slack_webhook_enc TEXT,
  email_to TEXT,
  on_approval BOOLEAN NOT NULL DEFAULT true,
  on_failure BOOLEAN NOT NULL DEFAULT true,
  on_cap BOOLEAN NOT NULL DEFAULT true,
  on_digest BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members manage notification settings" ON public.notification_settings;
CREATE POLICY "members manage notification settings" ON public.notification_settings
  FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));

DROP TRIGGER IF EXISTS notification_settings_updated_at ON public.notification_settings;
CREATE TRIGGER notification_settings_updated_at BEFORE UPDATE ON public.notification_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
