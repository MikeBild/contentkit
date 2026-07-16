-- Reader access control. Policies are snapshotted per immutable release so an
-- activation and a rollback switch content and visibility together. Reader
-- credentials remain site-scoped and can be revoked immediately.
create table if not exists public.ck_access_users (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.ck_sites(id) on delete cascade,
  username text not null,
  display_name text not null default '',
  password_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, username),
  check (username ~ '^[a-z0-9][a-z0-9._-]{2,63}$')
);

create table if not exists public.ck_access_groups (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.ck_sites(id) on delete cascade,
  slug text not null,
  name text not null,
  created_at timestamptz not null default now(),
  unique (site_id, slug),
  check (slug ~ '^[a-z0-9][a-z0-9-]{0,63}$')
);

create table if not exists public.ck_access_group_members (
  group_id uuid not null references public.ck_access_groups(id) on delete cascade,
  user_id uuid not null references public.ck_access_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table if not exists public.ck_access_rules (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.ck_sites(id) on delete cascade,
  match text not null check (match in ('exact', 'prefix')),
  path text not null check (path like '/%'),
  group_slugs text[] not null default '{}',
  user_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, match, path),
  check (cardinality(group_slugs) > 0 or cardinality(user_ids) > 0)
);

create table if not exists public.ck_release_access_entries (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.ck_releases(id) on delete cascade,
  site_id uuid not null references public.ck_sites(id) on delete cascade,
  match text not null check (match in ('exact', 'prefix')),
  path text not null check (path like '/%'),
  group_slugs text[] not null default '{}',
  user_ids uuid[] not null default '{}',
  content_item_id uuid references public.ck_content_items(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (release_id, match, path)
);

create table if not exists public.ck_reader_sessions (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.ck_sites(id) on delete cascade,
  user_id uuid not null references public.ck_access_users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  absolute_expires_at timestamptz not null,
  last_used_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.ck_release_access_catalog (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.ck_releases(id) on delete cascade,
  site_id uuid not null references public.ck_sites(id) on delete cascade,
  content_item_id uuid not null references public.ck_content_items(id) on delete cascade,
  locale text not null,
  title text not null,
  summary text not null default '',
  url text not null,
  layout text,
  parent_key text,
  nav_order double precision,
  search_text text not null default '',
  group_slugs text[] not null default '{}',
  user_ids uuid[] not null default '{}',
  unique (release_id, content_item_id)
);

create index if not exists ck_access_users_site_active_idx on public.ck_access_users (site_id, active);
create index if not exists ck_access_groups_site_idx on public.ck_access_groups (site_id, slug);
create index if not exists ck_access_members_user_idx on public.ck_access_group_members (user_id);
create index if not exists ck_access_rules_site_idx on public.ck_access_rules (site_id, path);
create index if not exists ck_release_access_lookup_idx on public.ck_release_access_entries (release_id, path);
create index if not exists ck_reader_sessions_lookup_idx on public.ck_reader_sessions (token_hash) where revoked_at is null;
create index if not exists ck_reader_sessions_user_idx on public.ck_reader_sessions (user_id) where revoked_at is null;
create index if not exists ck_release_access_catalog_idx on public.ck_release_access_catalog (release_id, locale);
