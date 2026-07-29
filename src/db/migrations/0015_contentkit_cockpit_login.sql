-- ContentKit Cockpit signs in through the same OIDC funnel as an MCP
-- client, but it is not an OAuth client: it wants the operator session cookie
-- and nothing else, so there is no client to register, no redirect_uri to
-- validate against one, no PKCE challenge to answer and no resource to bind.
-- `purpose` tells finishLogin() which of the two exits to take; the four
-- columns it does not use become nullable. The default covers every existing
-- row, so no backfill is required.
alter table public.ck_oauth_login_states
  add column if not exists purpose text not null default 'oauth',
  add column if not exists return_to text;

alter table public.ck_oauth_login_states
  alter column client_id drop not null,
  alter column redirect_uri drop not null,
  alter column requested_scopes drop not null,
  alter column code_challenge drop not null,
  alter column resource drop not null;

-- A cockpit state must not carry OAuth machinery and an OAuth state must
-- stay complete: the two shapes are mutually exclusive by construction.
alter table public.ck_oauth_login_states
  drop constraint if exists ck_oauth_login_states_purpose_shape;
alter table public.ck_oauth_login_states
  add constraint ck_oauth_login_states_purpose_shape check (
    (
      purpose = 'oauth'
      and client_id is not null
      and redirect_uri is not null
      and requested_scopes is not null
      and code_challenge is not null
      and resource is not null
      and return_to is null
    )
    or (
      purpose = 'cockpit'
      and client_id is null
      and redirect_uri is null
      and requested_scopes is null
      and code_challenge is null
      and resource is null
    )
  );
