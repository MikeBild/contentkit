-- Pre-rendered read-aloud audio ("Vorlesen"): one asynchronous TTS job per
-- (content item, speech-text hash). The uniqueness hash covers the *extracted
-- speech text*, not the Markdown source, so editing a code block or the sources
-- section never triggers a paid re-synthesis. The finished MP3 lives in
-- ck_assets like any uploaded asset and is served release-independently via
-- /media/<asset-id>/<filename>.
create table if not exists public.ck_audio_jobs (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.ck_sites(id) on delete cascade,
  item_id uuid not null references public.ck_content_items(id) on delete cascade,
  revision_id uuid not null references public.ck_content_revisions(id) on delete cascade,
  speech_sha256 text not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'done', 'failed', 'skipped')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  asset_id uuid references public.ck_assets(id) on delete set null,
  duration_secs integer,
  chars integer,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (item_id, speech_sha256)
);
-- 'processing' stays in the due index: it doubles as a lease. The worker pushes
-- next_attempt_at forward when it claims a job, so a crash mid-synthesis leaves
-- a row that becomes due again once the lease expires.
create index if not exists ck_audio_jobs_due_idx
  on public.ck_audio_jobs (next_attempt_at, created_at) where status in ('pending', 'processing');
create index if not exists ck_audio_jobs_site_status_idx
  on public.ck_audio_jobs (site_id, status, created_at desc);
create index if not exists ck_audio_jobs_item_idx
  on public.ck_audio_jobs (item_id, created_at desc);
