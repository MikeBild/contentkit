-- Product analytics remain site-scoped and are derived from ContentKit's own
-- PostgreSQL data. Reader auth events intentionally contain no username, IP,
-- session id or failure detail: only the site, bounded outcome and timestamp.
create table if not exists public.ck_reader_auth_events (
  id bigserial primary key,
  site_id uuid not null references public.ck_sites(id) on delete cascade,
  outcome text not null check (outcome in ('success', 'failed', 'rate_limited')),
  created_at timestamptz not null default now()
);

create index if not exists ck_reader_auth_events_site_created_idx
  on public.ck_reader_auth_events (site_id, created_at);
create index if not exists ck_reader_auth_events_created_idx
  on public.ck_reader_auth_events (created_at);
create index if not exists ck_content_items_site_created_idx
  on public.ck_content_items (site_id, created_at);
create index if not exists ck_content_revisions_item_created_idx
  on public.ck_content_revisions (item_id, created_at);
create index if not exists ck_content_revisions_item_published_idx
  on public.ck_content_revisions (item_id, published_at)
  where published_at is not null;
create index if not exists ck_assets_site_created_idx
  on public.ck_assets (site_id, created_at);
create index if not exists ck_releases_site_created_idx
  on public.ck_releases (site_id, created_at);
create index if not exists ck_releases_site_completed_idx
  on public.ck_releases (site_id, completed_at)
  where completed_at is not null;
create index if not exists ck_releases_site_activated_idx
  on public.ck_releases (site_id, activated_at)
  where activated_at is not null;
create index if not exists ck_post_feedback_site_created_idx
  on public.ck_post_feedback (site_id, created_at);
create index if not exists ck_reader_sessions_site_created_idx
  on public.ck_reader_sessions (site_id, created_at);
create index if not exists ck_outbox_events_site_created_idx
  on public.ck_outbox_events (site_id, created_at);
create index if not exists ck_audio_jobs_site_created_idx
  on public.ck_audio_jobs (site_id, created_at);
create index if not exists ck_audio_jobs_site_updated_idx
  on public.ck_audio_jobs (site_id, updated_at);
create index if not exists ck_comments_site_created_idx
  on public.ck_comments (site_id, created_at);
create index if not exists ck_comments_site_moderated_idx
  on public.ck_comments (site_id, moderated_at)
  where moderated_at is not null;
