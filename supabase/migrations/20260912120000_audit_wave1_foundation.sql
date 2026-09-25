-- Audit wave 1 — foundation. Schema-only changes that later waves depend on.
-- Nothing here changes behaviour on its own; each statement is additive and
-- safe to re-run.
--
-- 1) scheduled_posts.status had no value for "we tried to publish this and it
--    failed", so a failed autonomous publish was unrepresentable. runDailyPost
--    in src/lib/cron-executors.server.ts inserts the row with status
--    'scheduled' BEFORE calling publishScheduledPostToBuffer, and that helper
--    never throws — so a post that never reached Buffer is stored as a
--    healthy-looking 'scheduled' row, indistinguishable from a real one. A
--    later wave writes 'publish_failed' on that path and adds a reconciliation
--    query; this migration only makes the value legal.
--
-- 2) image_providers.provider rejected 'azure' even though the Settings UI
--    (src/routes/conexiones.tsx), the zod validator
--    (src/lib/image-providers.functions.ts) and a full adapter
--    (generateAzure in src/lib/image-gen.server.ts) all support it — the
--    advertised provider simply could not be saved. Same class of bug, and the
--    same fix, as 20260818090000_video_provider_kinds.sql did for
--    video_providers.
--
-- 3) Two additive indexes. ai_usage_month_total filters on
--    workspace_id + action = 'ai.usage' + a created_at range, but the only
--    usable index is activity_log_action_idx (workspace_id, action), so
--    created_at is applied as a post-scan Filter and every monthly-cap check
--    walks every ai.usage row the workspace has ever produced. And
--    llm_providers had no index other than its primary key, yet every chat
--    turn and every automation resolves a model by workspace_id.

alter table public.scheduled_posts drop constraint if exists scheduled_posts_status_check;
alter table public.scheduled_posts add constraint scheduled_posts_status_check
  check (status in ('draft', 'scheduled', 'published', 'pending_approval', 'rejected', 'publish_failed'));

alter table public.image_providers drop constraint if exists image_providers_provider_check;
alter table public.image_providers add constraint image_providers_provider_check
  check (provider in ('openai', 'gemini', 'azure'));

create index if not exists activity_log_ws_action_created_idx
  on public.activity_log (workspace_id, action, created_at DESC);

create index if not exists llm_providers_workspace_idx
  on public.llm_providers (workspace_id);
