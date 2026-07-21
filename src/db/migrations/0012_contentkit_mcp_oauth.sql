-- MCP OAuth 2.1, operator grants, audit, idempotency and privacy-bounded MCP
-- usage. Secrets are never stored in plaintext: browser sessions, codes and
-- tokens are random high-entropy values represented here only by keyed hashes.
create table if not exists public.ck_oauth_identity_grants (
  id uuid primary key default gen_random_uuid(),
  provider_id text not null check (provider_id ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  issuer text not null,
  subject text not null,
  email text,
  display_name text not null default '',
  role text not null check (role in ('reader', 'author', 'admin')),
  product_scopes text[] not null default '{}',
  site_ids uuid[] not null default '{}',
  source_credential_hash text,
  source_pepper_fingerprint text,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_id, issuer, subject),
  check (
    provider_id <> 'api-key'
    or (source_credential_hash is not null and source_pepper_fingerprint is not null)
  )
);

create table if not exists public.ck_operator_sessions (
  id uuid primary key default gen_random_uuid(),
  grant_id uuid not null references public.ck_oauth_identity_grants(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  absolute_expires_at timestamptz not null,
  last_used_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.ck_oauth_clients (
  client_id text primary key,
  client_name text not null,
  redirect_uris text[] not null,
  token_endpoint_auth_method text not null default 'none' check (token_endpoint_auth_method = 'none'),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.ck_oauth_login_states (
  id uuid primary key default gen_random_uuid(),
  state_hash text not null unique,
  client_id text not null references public.ck_oauth_clients(client_id) on delete cascade,
  redirect_uri text not null,
  requested_scopes text[] not null,
  code_challenge text not null,
  resource text not null,
  client_state text,
  provider_id text,
  oidc_nonce text,
  oidc_code_verifier text,
  grant_id uuid references public.ck_oauth_identity_grants(id) on delete set null,
  expires_at timestamptz not null,
  authenticated_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.ck_oauth_authorization_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  client_id text not null references public.ck_oauth_clients(client_id) on delete cascade,
  grant_id uuid not null references public.ck_oauth_identity_grants(id) on delete cascade,
  redirect_uri text not null,
  scopes text[] not null,
  site_ids uuid[] not null default '{}',
  resource text not null,
  code_challenge text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.ck_oauth_access_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  client_id text not null references public.ck_oauth_clients(client_id) on delete cascade,
  grant_id uuid not null references public.ck_oauth_identity_grants(id) on delete cascade,
  scopes text[] not null,
  site_ids uuid[] not null default '{}',
  resource text not null,
  family_id uuid not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.ck_oauth_refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  client_id text not null references public.ck_oauth_clients(client_id) on delete cascade,
  grant_id uuid not null references public.ck_oauth_identity_grants(id) on delete cascade,
  scopes text[] not null,
  site_ids uuid[] not null default '{}',
  resource text not null,
  family_id uuid not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  revoked_at timestamptz,
  replaced_by_id uuid references public.ck_oauth_refresh_tokens(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.ck_audit_events (
  id bigserial primary key,
  site_id uuid references public.ck_sites(id) on delete set null,
  actor_type text not null check (actor_type in ('api_key', 'oauth', 'operator', 'system')),
  actor_id text,
  action text not null check (action ~ '^[a-z][a-z0-9_.:-]{0,119}$'),
  resource_type text not null check (resource_type ~ '^[a-z][a-z0-9_.:-]{0,79}$'),
  resource_id text,
  result text not null check (result in ('success', 'denied', 'failed', 'cancelled')),
  transport text not null check (transport in ('http', 'mcp', 'oauth', 'worker')),
  request_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.ck_idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  actor_id text not null,
  operation text not null,
  idempotency_key text not null,
  input_sha256 text not null,
  result jsonb,
  status text not null default 'running' check (status in ('running', 'done', 'failed')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (actor_id, operation, idempotency_key)
);

create index if not exists ck_oauth_grants_subject_idx
  on public.ck_oauth_identity_grants (provider_id, issuer, subject) where revoked_at is null;
create index if not exists ck_operator_sessions_grant_idx
  on public.ck_operator_sessions (grant_id) where revoked_at is null;
create index if not exists ck_oauth_login_states_expiry_idx
  on public.ck_oauth_login_states (expires_at) where consumed_at is null;
create index if not exists ck_oauth_codes_expiry_idx
  on public.ck_oauth_authorization_codes (expires_at) where consumed_at is null;
create index if not exists ck_oauth_access_grant_idx
  on public.ck_oauth_access_tokens (grant_id, expires_at) where revoked_at is null;
create index if not exists ck_oauth_refresh_family_idx
  on public.ck_oauth_refresh_tokens (family_id, expires_at) where revoked_at is null;
create index if not exists ck_audit_site_created_idx on public.ck_audit_events (site_id, created_at desc);
create index if not exists ck_audit_action_created_idx on public.ck_audit_events (action, created_at desc);
create index if not exists ck_idempotency_expiry_idx on public.ck_idempotency_keys (expires_at);

alter table public.ck_deck_build_events drop constraint if exists ck_deck_build_events_execution_check;
alter table public.ck_deck_build_events
  add constraint ck_deck_build_events_execution_check check (execution in ('sync', 'async', 'mcp'));

alter table public.ck_usage_events alter column site_id drop not null;
alter table public.ck_usage_events drop constraint if exists ck_usage_events_surface_check;
alter table public.ck_usage_events
  add constraint ck_usage_events_surface_check check (surface in ('http', 'composition', 'mcp'));
alter table public.ck_usage_events drop constraint if exists ck_usage_events_request_source_check;
alter table public.ck_usage_events
  add constraint ck_usage_events_request_source_check
  check (request_source in ('api', 'gateway', 'reader', 'scheduler', 'manual', 'mcp'));
alter table public.ck_usage_events add column if not exists tool_name text
  check (tool_name is null or tool_name ~ '^[a-z][a-z0-9_.:-]{0,127}$');
alter table public.ck_usage_events add column if not exists resource_kind text
  check (resource_kind is null or resource_kind ~ '^[a-z][a-z0-9_.:-]{0,79}$');
alter table public.ck_usage_events add column if not exists response_mode text
  check (response_mode is null or response_mode in ('json', 'sse', 'none'));
alter table public.ck_usage_events add column if not exists result_count integer
  check (result_count is null or result_count >= 0);
alter table public.ck_usage_events add column if not exists active_sessions integer
  check (active_sessions is null or active_sessions >= 0);
create index if not exists ck_usage_events_mcp_created_idx
  on public.ck_usage_events (surface, created_at) where surface = 'mcp';
