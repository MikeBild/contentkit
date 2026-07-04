-- Contentkit schema baseline. Embedded in the single binary; never applied by
-- deployment scripts. Keep changes additive and create a new migration after release.
create extension if not exists pgcrypto;

create table if not exists public.ck_sites (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  name text not null,
  description text not null default '',
  base_url text not null,
  default_locale text not null,
  settings jsonb not null default '{}'::jsonb,
  active_release_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ck_site_domains (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.ck_sites(id) on delete cascade,
  hostname text not null unique,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  check (hostname = lower(hostname))
);

create table if not exists public.ck_site_locales (
  site_id uuid not null references public.ck_sites(id) on delete cascade,
  locale text not null,
  created_at timestamptz not null default now(),
  primary key (site_id, locale)
);

create table if not exists public.ck_api_keys (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  key_prefix text not null,
  key_hash text not null unique,
  scopes text[] not null default '{}',
  site_ids uuid[] not null default '{}',
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.ck_content_items (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.ck_sites(id) on delete cascade,
  kind text not null check (kind in ('page', 'post', 'project')),
  locale text not null,
  translation_key text not null,
  published_revision_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, kind, locale, translation_key)
);

create table if not exists public.ck_content_revisions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.ck_content_items(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'published', 'archived')),
  markdown text not null,
  source_sha256 text not null,
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  title text not null,
  summary text not null default '',
  tags text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  scheduled_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.ck_content_items
  drop constraint if exists ck_content_items_published_revision_id_fkey;
alter table public.ck_content_items
  add constraint ck_content_items_published_revision_id_fkey
  foreign key (published_revision_id) references public.ck_content_revisions(id) on delete set null;

create unique index if not exists ck_revision_slug_unique
  on public.ck_content_revisions (item_id, slug, source_sha256);
create index if not exists ck_revision_due_idx
  on public.ck_content_revisions (scheduled_at) where status = 'scheduled';

create table if not exists public.ck_assets (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.ck_sites(id) on delete cascade,
  sha256 text not null,
  filename text not null,
  storage_path text not null unique,
  content_type text not null,
  byte_size bigint not null check (byte_size >= 0),
  created_at timestamptz not null default now(),
  unique (site_id, sha256)
);

create table if not exists public.ck_releases (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.ck_sites(id) on delete cascade,
  kind text not null check (kind in ('release', 'preview')),
  status text not null check (status in ('building', 'preview', 'ready', 'active', 'superseded', 'failed')),
  reason text not null default '',
  revision_ids uuid[] not null default '{}',
  storage_prefix text,
  file_count integer not null default 0,
  error text,
  completed_at timestamptz,
  activated_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.ck_sites
  drop constraint if exists ck_sites_active_release_id_fkey;
alter table public.ck_sites
  add constraint ck_sites_active_release_id_fkey
  foreign key (active_release_id) references public.ck_releases(id) on delete set null;

create table if not exists public.ck_release_entries (
  release_id uuid not null references public.ck_releases(id) on delete cascade,
  path text not null,
  storage_path text not null,
  content_type text not null,
  byte_size bigint not null,
  sha256 text not null,
  primary key (release_id, path)
);

create table if not exists public.ck_preview_tokens (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.ck_releases(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.ck_comments (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.ck_sites(id) on delete cascade,
  content_item_id uuid not null references public.ck_content_items(id) on delete cascade,
  author_name text not null,
  author_email text,
  body text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  moderated_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.ck_contact_submissions (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.ck_sites(id) on delete cascade,
  name text not null,
  email text not null,
  body text not null,
  status text not null default 'new' check (status in ('new', 'read', 'closed')),
  created_at timestamptz not null default now()
);

create table if not exists public.ck_outbox_events (
  id uuid primary key,
  site_id uuid not null references public.ck_sites(id) on delete cascade,
  type text not null,
  resource_kind text not null,
  resource_id uuid not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'delivered', 'failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists ck_outbox_pending_idx
  on public.ck_outbox_events (next_attempt_at, created_at) where status = 'pending';
create index if not exists ck_site_domains_site_idx on public.ck_site_domains (site_id);
create index if not exists ck_sites_active_release_idx on public.ck_sites (active_release_id);
create index if not exists ck_content_items_published_revision_idx on public.ck_content_items (published_revision_id);
create index if not exists ck_releases_site_status_idx on public.ck_releases (site_id, status);
create unique index if not exists ck_releases_one_active_per_site
  on public.ck_releases (site_id) where status = 'active';
create index if not exists ck_preview_tokens_release_idx on public.ck_preview_tokens (release_id);
create index if not exists ck_comments_site_status_idx on public.ck_comments (site_id, status, created_at desc);
create index if not exists ck_comments_content_item_idx on public.ck_comments (content_item_id);
create index if not exists ck_contact_site_status_idx on public.ck_contact_submissions (site_id, status, created_at desc);
create index if not exists ck_outbox_site_idx on public.ck_outbox_events (site_id);

create or replace function public.ck_activate_release(p_release_id uuid, p_revision_ids uuid[] default '{}')
returns void
language plpgsql
set search_path = public
as $$
declare
  target public.ck_releases%rowtype;
begin
  select * into target from public.ck_releases where id = p_release_id for update;
  if target.id is null or target.kind <> 'release' or target.status not in ('ready', 'active', 'superseded') then
    raise exception 'release cannot be activated';
  end if;
  perform 1 from public.ck_sites where id = target.site_id for update;
  if cardinality(p_revision_ids) > 0 and (
    select count(distinct revision.id) <> cardinality(p_revision_ids)
      or bool_or(item.site_id <> target.site_id)
    from public.ck_content_revisions revision
    join public.ck_content_items item on item.id = revision.item_id
    where revision.id = any(p_revision_ids)
  ) then
    raise exception 'release revisions must all belong to the target site';
  end if;

  update public.ck_releases
    set status = 'superseded'
    where site_id = target.site_id and status = 'active' and id <> target.id;
  update public.ck_releases
    set status = 'active', activated_at = now()
    where id = target.id;
  update public.ck_sites
    set active_release_id = target.id, updated_at = now()
    where id = target.site_id;

  if cardinality(p_revision_ids) > 0 then
    update public.ck_content_revisions old
      set status = 'archived'
      from public.ck_content_items item, public.ck_content_revisions fresh
      where fresh.id = any(p_revision_ids)
        and item.id = fresh.item_id
        and old.id = item.published_revision_id
        and old.id <> fresh.id;

    update public.ck_content_revisions
      set status = 'published', published_at = coalesce(published_at, now())
      where id = any(p_revision_ids);

    update public.ck_content_items item
      set published_revision_id = fresh.id, updated_at = now()
      from public.ck_content_revisions fresh
      where fresh.id = any(p_revision_ids) and item.id = fresh.item_id;
  end if;
end;
$$;
