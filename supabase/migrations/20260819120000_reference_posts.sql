-- Swipe file: posts the user pastes into chat as references are stored in
-- social_posts with source = 'reference'. Widen the CHECK and add the author
-- display name plus an optional "why I saved this" note.
alter table public.social_posts drop constraint if exists social_posts_source_check;
alter table public.social_posts add constraint social_posts_source_check
  check (source in ('competitor', 'own', 'reference'));

alter table public.social_posts add column if not exists author text;
alter table public.social_posts add column if not exists note text;
