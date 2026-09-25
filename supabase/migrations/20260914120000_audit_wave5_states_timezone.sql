-- Audit wave 5. Three schema changes behind decisions the owner made after
-- reading the audit. Every statement is additive and safe to re-run.
--
-- 1) scheduled_posts.status gains 'publish_unknown'.
--
--    A publish request that times out leaves us genuinely unable to say what
--    happened: Buffer may have accepted the post, or not. Until now that was
--    recorded as 'publish_failed', which draws the right amount of attention but
--    asserts something we do not know — and a user who acts on it by publishing
--    again can end up with two live posts. 'publish_failed' still means Buffer
--    was asked and refused. The new value means the request went out and the
--    answer never came back. (docs/bugs.md finding 54.)
--
-- 2) workspaces.timezone.
--
--    'Europe/Madrid' is hard-coded in seven places, including the date the chat
--    agent reasons about and every hour-of-day and day-of-week bucket in the
--    performance analytics. For a workspace whose audience is not European that
--    silently shifts every timing insight by hours, and makes the agent's sense
--    of "today" wrong near midnight. Default stays Europe/Madrid so existing
--    behaviour is unchanged until someone sets it. (finding 21.)
--
--    Stored as text rather than an enum: IANA zone names change, and Postgres
--    already validates them via pg_timezone_names, which the CHECK below uses.
--
-- 3) Foreign keys on agent_memory.workspace_id and post_metrics.workspace_id.
--
--    These are the only two of 23 workspace_id columns without one, so deleting
--    a workspace leaves their rows behind pointing at an id that no longer
--    exists. Because every policy on both tables is is_workspace_member(...),
--    and the membership rows cascade away with the workspace, those orphans
--    become permanently unreachable through the API — invisible, undeletable,
--    and still counted by any service-role tooling. Not reachable today (there
--    is no workspace-deletion feature), but it becomes real the day one ships or
--    someone runs a manual delete for an erasure request. (finding 34.)
--
--    Verified before writing: zero orphan rows in either table, so both
--    constraints validate cleanly.

alter table public.scheduled_posts drop constraint if exists scheduled_posts_status_check;
alter table public.scheduled_posts add constraint scheduled_posts_status_check
  check (status in (
    'draft', 'scheduled', 'published', 'pending_approval', 'rejected',
    'publish_failed', 'publish_unknown'
  ));

alter table public.workspaces
  add column if not exists timezone text not null default 'Europe/Madrid';

comment on column public.workspaces.timezone is
  'IANA timezone for this workspace: the agent''s sense of "today", cron wall-clock, and the buckets used by performance analytics. Defaults to Europe/Madrid, which is what the code hard-coded before this column existed.';

-- Rejects a typo at write time rather than letting it surface as an analytics
-- bucket that is silently wrong. Postgres ships the zone list, so this stays
-- correct as zones are added or renamed.
--
-- A trigger rather than a CHECK constraint: a CHECK may only call IMMUTABLE
-- expressions, and looking a name up in pg_timezone_names is not one (the zone
-- database is loaded from the host and can change between server versions).
-- Postgres rejects the CHECK form outright with "cannot use subquery in check
-- constraint", so this is the supported way to get the same guarantee.
create or replace function public.validate_workspace_timezone()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if not exists (select 1 from pg_timezone_names where name = new.timezone) then
    raise exception '% is not a known IANA timezone. Use the Area/City form, for example Europe/Madrid or Australia/Sydney.', new.timezone
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists workspaces_validate_timezone on public.workspaces;
create trigger workspaces_validate_timezone
  before insert or update of timezone on public.workspaces
  for each row execute function public.validate_workspace_timezone();

alter table public.agent_memory drop constraint if exists agent_memory_workspace_id_fkey;
alter table public.agent_memory add constraint agent_memory_workspace_id_fkey
  foreign key (workspace_id) references public.workspaces(id) on delete cascade;

alter table public.post_metrics drop constraint if exists post_metrics_workspace_id_fkey;
alter table public.post_metrics add constraint post_metrics_workspace_id_fkey
  foreign key (workspace_id) references public.workspaces(id) on delete cascade;
