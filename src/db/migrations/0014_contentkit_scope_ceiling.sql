-- Scope-ceiling contract v1: product_scopes is the only stored truth of a
-- grant. The role column is degraded to a denormalized display/compat value —
-- nullable from now on, still written by the server, never read for
-- authorization. It is kept (not dropped) because the rolling auto-deploy
-- window lets a v4.2 binary write role for up to 30 minutes; the column is
-- removed in v5.0.0. grant_source records who manages a row so the seeder can
-- skip operator-managed grants.
alter table public.ck_oauth_identity_grants
  alter column role drop not null;

alter table public.ck_oauth_identity_grants
  drop constraint if exists ck_oauth_identity_grants_role_check;

alter table public.ck_oauth_identity_grants
  add constraint ck_oauth_identity_grants_role_check
  check (role is null or role in ('reader', 'author', 'admin'));

alter table public.ck_oauth_identity_grants
  add column if not exists grant_source text not null default 'admin'
  constraint ck_oauth_identity_grants_grant_source_check
  check (grant_source in ('admin', 'seed', 'signup', 'api-key'));

-- Backfill: api-key rows are derived grants managed by the API-key upsert;
-- every existing SSO row was written by the reconcile seeder.
update public.ck_oauth_identity_grants set grant_source = 'api-key' where provider_id = 'api-key';

update public.ck_oauth_identity_grants set grant_source = 'seed' where provider_id <> 'api-key';
