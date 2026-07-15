-- One-click post feedback (thumbs up/down). Anonymous by design: no name, no
-- email, no IP — nothing here is personal data, so there is nothing to moderate
-- or purge. Aggregates are read on demand via GET /v1/feedback.
create table if not exists public.ck_post_feedback (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.ck_sites(id) on delete cascade,
  content_item_id uuid not null references public.ck_content_items(id) on delete cascade,
  vote text not null check (vote in ('up', 'down')),
  created_at timestamptz not null default now()
);
create index if not exists ck_post_feedback_item_idx
  on public.ck_post_feedback (site_id, content_item_id);
