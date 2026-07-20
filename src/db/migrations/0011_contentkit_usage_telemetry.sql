-- Opt-in, privacy-bounded product usage telemetry. Events deliberately contain
-- no content, URL/query values, network identifiers, credentials or dynamic
-- resource ids. Actors and sessions are product-local HMACs computed in the
-- application before this append-only row is written.
create table if not exists public.ck_usage_events (
  id bigserial primary key,
  site_id uuid not null references public.ck_sites(id) on delete cascade,
  surface text not null check (surface in ('http', 'composition')),
  operation text not null check (operation ~ '^[a-z][a-z0-9_.:-]{0,79}$'),
  route text check (route is null or (length(route) between 1 and 200 and route not like '%?%')),
  method text check (method is null or method in ('GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS')),
  status_code integer check (status_code is null or status_code between 100 and 599),
  outcome text not null check (outcome in ('success', 'client_error', 'server_error', 'rejected', 'timeout', 'cancelled')),
  traffic_class text not null default 'organic' check (traffic_class in ('organic', 'synthetic', 'internal')),
  request_source text not null default 'api' check (request_source in ('api', 'gateway', 'reader', 'scheduler', 'manual')),
  actor_hmac text check (actor_hmac is null or actor_hmac ~ '^[0-9a-f]{64}$'),
  session_hmac text check (session_hmac is null or session_hmac ~ '^[0-9a-f]{64}$'),
  duration_ms bigint not null default 0 check (duration_ms >= 0),
  request_bytes bigint check (request_bytes is null or request_bytes >= 0),
  response_bytes bigint check (response_bytes is null or response_bytes >= 0),
  semantic_node_count integer check (semantic_node_count is null or semantic_node_count >= 0),
  diagnostic_count integer check (diagnostic_count is null or diagnostic_count >= 0),
  requested_pattern text check (requested_pattern is null or requested_pattern ~ '^[a-z][a-z0-9-]{0,79}$'),
  resolved_pattern text check (resolved_pattern is null or resolved_pattern ~ '^[a-z][a-z0-9-]{0,79}$'),
  fallback boolean,
  output_format text check (output_format is null or output_format in ('json', 'html', 'svg', 'png')),
  created_at timestamptz not null default now()
);

create index if not exists ck_usage_events_site_created_idx
  on public.ck_usage_events (site_id, created_at);
create index if not exists ck_usage_events_site_surface_created_idx
  on public.ck_usage_events (site_id, surface, created_at);
create index if not exists ck_usage_events_created_idx
  on public.ck_usage_events (created_at);
