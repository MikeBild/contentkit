-- First-class semantic slide decks and privacy-bounded build telemetry.
alter table public.ck_content_items
  drop constraint if exists ck_content_items_kind_check;
alter table public.ck_content_items
  add constraint ck_content_items_kind_check
  check (kind in ('page', 'post', 'project', 'deck'));

create table if not exists public.ck_deck_build_events (
  id bigserial primary key,
  site_id uuid not null references public.ck_sites(id) on delete cascade,
  mode text not null check (mode in ('plan', 'validate', 'compile', 'preview', 'release')),
  result text not null check (result in ('success', 'error', 'timeout', 'rejected')),
  execution text not null default 'sync' check (execution in ('sync', 'async')),
  cache_result text check (cache_result is null or cache_result in ('hit', 'miss')),
  slide_count integer not null default 0 check (slide_count >= 0),
  svg_count integer not null default 0 check (svg_count >= 0),
  png_count integer not null default 0 check (png_count >= 0),
  output_bytes bigint not null default 0 check (output_bytes >= 0),
  duration_ms bigint not null default 0 check (duration_ms >= 0),
  diagnostic_count integer not null default 0 check (diagnostic_count >= 0),
  created_at timestamptz not null default now()
);

create index if not exists ck_deck_build_events_site_created_idx
  on public.ck_deck_build_events (site_id, created_at);
create index if not exists ck_deck_build_events_created_idx
  on public.ck_deck_build_events (created_at);
