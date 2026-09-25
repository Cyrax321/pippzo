ALTER TABLE public.scheduled_posts
  ADD COLUMN IF NOT EXISTS video_url TEXT;