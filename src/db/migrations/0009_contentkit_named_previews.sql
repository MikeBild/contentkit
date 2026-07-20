-- Named previews separate a one-time secret invitation from the memorable URL
-- used after exchange. Existing bearer-token previews are intentionally
-- invalidated: the old URL exposed its credential on every asset request.
drop table if exists public.ck_preview_tokens;

create table public.ck_preview_access (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.ck_releases(id) on delete cascade,
  slug text not null unique,
  invite_token_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  session_token_hash text unique,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (slug ~ '^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$'),
  check ((consumed_at is null and session_token_hash is null) or
         (consumed_at is not null and session_token_hash is not null))
);

create index ck_preview_access_release_idx on public.ck_preview_access (release_id);
create index ck_preview_access_session_idx on public.ck_preview_access (slug, session_token_hash)
  where revoked_at is null and session_token_hash is not null;
