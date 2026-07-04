-- Modern webhook delivery: per-site subscription endpoints with independent
-- signing secrets and event filters, plus a per-endpoint delivery ledger that
-- records every attempt (for retries, observability and manual redelivery).
create table if not exists public.ck_webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.ck_sites(id) on delete cascade,
  url text not null,
  secret_encrypted text not null,
  events text[] not null default '{}',
  description text not null default '',
  disabled_at timestamptz,
  consecutive_failures integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ck_webhook_endpoints_site_idx on public.ck_webhook_endpoints (site_id);
create index if not exists ck_webhook_endpoints_active_idx on public.ck_webhook_endpoints (site_id) where disabled_at is null;

create table if not exists public.ck_webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  endpoint_id uuid references public.ck_webhook_endpoints(id) on delete cascade,
  site_id uuid not null references public.ck_sites(id) on delete cascade,
  event_id uuid not null,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'delivered', 'failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  response_status integer,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);
-- A NULL endpoint_id delivery targets the legacy env-configured default endpoint.
create index if not exists ck_webhook_deliveries_due_idx
  on public.ck_webhook_deliveries (next_attempt_at, created_at) where status = 'pending';
create index if not exists ck_webhook_deliveries_endpoint_idx
  on public.ck_webhook_deliveries (endpoint_id, created_at desc);
create index if not exists ck_webhook_deliveries_site_idx
  on public.ck_webhook_deliveries (site_id, created_at desc);
