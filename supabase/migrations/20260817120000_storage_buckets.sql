-- Creates the two storage buckets the app writes to.
--
-- The RLS policies for these buckets already exist (see the 20260630050454 and
-- 20260710081233 migrations) but the buckets themselves were provisioned out of
-- band by the hosting platform, so a fresh database had policies pointing at
-- buckets that did not exist. This makes the schema self-contained.
--
-- ON CONFLICT DO NOTHING keeps it safe to run against a database where the
-- buckets were already created by hand.

-- Brand/library media. Private: read paths go through signed URLs.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('media', 'media', false, 209715200)
ON CONFLICT (id) DO NOTHING;

-- Media handed to Buffer at publish time via long-lived signed URLs.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('buffer-media', 'buffer-media', false, 209715200)
ON CONFLICT (id) DO NOTHING;
