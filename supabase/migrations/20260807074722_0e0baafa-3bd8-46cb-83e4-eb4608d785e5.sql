ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS require_approval boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS monthly_token_cap integer NOT NULL DEFAULT 0;

DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
   WHERE conrelid = 'public.scheduled_posts'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%status%';
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.scheduled_posts DROP CONSTRAINT %I', c);
  END IF;
END $$;

ALTER TABLE public.scheduled_posts
  ADD CONSTRAINT scheduled_posts_status_check
  CHECK (status IN ('draft','scheduled','published','pending_approval','rejected'));