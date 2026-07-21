-- OAuth consent is a browser POST followed by a cross-origin redirect to the
-- registered client. Some clients repeat that POST while handling the redirect.
-- Keep the already-issued authorization response encrypted for one short replay
-- window so a duplicate decision is idempotent without minting another code.
alter table public.ck_oauth_login_states
  add column if not exists authorization_response_encrypted text,
  add column if not exists authorization_response_expires_at timestamptz;

alter table public.ck_oauth_login_states
  drop constraint if exists ck_oauth_login_states_authorization_response_check;

alter table public.ck_oauth_login_states
  add constraint ck_oauth_login_states_authorization_response_check check (
    (authorization_response_encrypted is null and authorization_response_expires_at is null)
    or
    (authorization_response_encrypted is not null and authorization_response_expires_at is not null and consumed_at is not null)
  );
