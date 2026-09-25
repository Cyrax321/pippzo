-- Audit wave 3b — concurrency. Schema support for making three racy paths safe.
-- Every statement is additive and safe to re-run.
--
-- 1) scheduled_posts.publish_claimed_at gives publishScheduledPostToBuffer a
--    way to claim a post before it calls Buffer. Today nothing stops the same
--    post being published twice: the cron path, the Approvals screen, the batch
--    publish when approval is turned off, and the agent's approve tool all
--    reach the same helper, and none of them checks whether a publish is
--    already in flight or already succeeded. A retry after a network timeout,
--    a double-click, or two overlapping cron ticks each produce a second real
--    post on a real social channel.
--
--    Nullable with no default on purpose: NULL means "never attempted", which
--    is the correct reading for every row that already exists. The claim is
--    taken with a conditional UPDATE ... WHERE buffer_id IS NULL AND
--    (publish_claimed_at IS NULL OR publish_claimed_at < now() - interval),
--    so a claim left behind by a crashed process expires instead of wedging
--    the post forever.
--
-- 2) The two partial unique indexes enforce what the application already
--    assumes but never guaranteed: at most one default provider per workspace.
--    saveImageProvider / setDefaultImageProvider (and their llm_providers
--    twins) clear every default and then set one, across two separate
--    PostgREST round trips with no transaction. Two concurrent saves can
--    therefore leave two rows with is_default = true, after which
--    llm-resolver.server.ts's `order by is_default desc, created_at desc`
--    silently tiebreaks on creation order rather than on what the user picked.
--
--    Verified before writing: no workspace currently has more than one default
--    in either table, so both indexes build cleanly.

alter table public.scheduled_posts
  add column if not exists publish_claimed_at timestamptz;

comment on column public.scheduled_posts.publish_claimed_at is
  'Set when a publish attempt claims this post, so the same post cannot be published twice by concurrent callers. Cleared/ignored once buffer_id is set. A stale claim expires; see buffer-publish.server.ts.';

create unique index if not exists image_providers_one_default_per_workspace
  on public.image_providers (workspace_id)
  where is_default;

create unique index if not exists llm_providers_one_default_per_workspace
  on public.llm_providers (workspace_id)
  where is_default;
