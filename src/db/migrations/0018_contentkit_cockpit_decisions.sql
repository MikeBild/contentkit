-- The Cockpit decision queue is durable product state. Audit rows remain the
-- immutable history, but are deliberately not queried as a substitute for the
-- current state of a decision.
alter table public.ck_sites
  add column if not exists environment text not null default 'production';

alter table public.ck_sites
  drop constraint if exists ck_sites_environment_check;
alter table public.ck_sites
  add constraint ck_sites_environment_check
  check (environment in ('production', 'canary', 'test'));

alter table public.ck_oauth_identity_grants
  add column if not exists last_used_at timestamptz;

update public.ck_oauth_identity_grants grant_row
set last_used_at = usage.last_used_at
from (
  select grant_id, max(last_used_at) as last_used_at
  from public.ck_operator_sessions
  group by grant_id
) usage
where grant_row.id = usage.grant_id and grant_row.last_used_at is null;

create table if not exists public.ck_draft_captures (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.ck_sites(id) on delete cascade,
  text text not null default '',
  status text not null default 'pending'
    check (status in ('pending', 'triaged', 'discarded')),
  content_item_id uuid references public.ck_content_items(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  triaged_at timestamptz,
  discarded_at timestamptz
);

create table if not exists public.ck_promotion_reviews (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.ck_sites(id) on delete cascade,
  release_id uuid not null references public.ck_releases(id) on delete cascade,
  manifest_sha256 text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending'
    check (status in ('pending', 'rejected', 'activated', 'expired')),
  reason text not null default '',
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (site_id, release_id, manifest_sha256)
);

create table if not exists public.ck_decisions (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.ck_sites(id) on delete cascade,
  kind text not null
    check (kind in ('draft_capture', 'comment', 'contact', 'feedback', 'promotion')),
  source_id uuid not null,
  source_version text not null,
  state text not null default 'open'
    check (state in ('open', 'deferred', 'dismissed', 'decided')),
  version integer not null default 1 check (version > 0),
  opened_at timestamptz not null default now(),
  due_at timestamptz not null default (now() + interval '72 hours'),
  remind_at timestamptz,
  decided_at timestamptz,
  outcome text,
  reason text not null default '',
  actor_id text,
  updated_at timestamptz not null default now(),
  unique (site_id, kind, source_id, source_version)
);

create index if not exists ck_decisions_queue_idx
  on public.ck_decisions (site_id, state, due_at, opened_at);
create index if not exists ck_draft_captures_pending_idx
  on public.ck_draft_captures (site_id, created_at) where status = 'pending';
create index if not exists ck_promotion_reviews_pending_idx
  on public.ck_promotion_reviews (site_id, requested_at) where status = 'pending';

-- Existing actionable moderation rows enter the new queue once. Canonical
-- content drafts are intentionally not inferred to be inbox captures.
insert into public.ck_decisions
  (site_id, kind, source_id, source_version, opened_at, due_at)
select site_id, 'comment', id, created_at::text, created_at, created_at + interval '72 hours'
from public.ck_comments
where status = 'pending'
on conflict (site_id, kind, source_id, source_version) do nothing;

insert into public.ck_decisions
  (site_id, kind, source_id, source_version, opened_at, due_at)
select site_id, 'contact', id, created_at::text, created_at, created_at + interval '72 hours'
from public.ck_contact_submissions
where status = 'new'
on conflict (site_id, kind, source_id, source_version) do nothing;

insert into public.ck_decisions
  (site_id, kind, source_id, source_version, opened_at, due_at)
select site_id, 'feedback', content_item_id, min(created_at)::text,
       min(created_at), min(created_at) + interval '72 hours'
from public.ck_post_feedback
group by site_id, content_item_id
on conflict (site_id, kind, source_id, source_version) do nothing;
