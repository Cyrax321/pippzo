
alter table public.competitors
  add column if not exists handles jsonb not null default '{}'::jsonb;

alter table public.brand_profile
  add column if not exists own_handles jsonb not null default '{}'::jsonb;

create table if not exists public.social_posts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source text not null check (source in ('competitor','own')),
  competitor_id uuid references public.competitors(id) on delete cascade,
  network text not null,
  external_id text not null,
  url text,
  published_at timestamptz,
  caption text,
  media_type text,
  metrics jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  unique (workspace_id, network, external_id)
);

grant select, insert, update, delete on public.social_posts to authenticated;
grant all on public.social_posts to service_role;

alter table public.social_posts enable row level security;

create policy "workspace members read social_posts"
  on public.social_posts for select
  to authenticated
  using (public.is_workspace_member(workspace_id, auth.uid()));

create policy "workspace members write social_posts"
  on public.social_posts for all
  to authenticated
  using (public.is_workspace_member(workspace_id, auth.uid()))
  with check (public.is_workspace_member(workspace_id, auth.uid()));

create index if not exists social_posts_ws_network_published_idx
  on public.social_posts (workspace_id, network, published_at desc);
create index if not exists social_posts_competitor_idx
  on public.social_posts (competitor_id) where competitor_id is not null;
