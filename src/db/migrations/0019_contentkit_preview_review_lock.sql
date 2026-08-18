-- A reviewable preview and a derived release must not invalidate each other.
--
-- Preview registration now takes the same site lock as activation and checks
-- the epoch while holding it. A preview therefore either registers against the
-- exact current snapshot or is rebuilt; it can no longer be born stale in the
-- final milliseconds of a concurrent activation.
--
-- Audio auto-rebuilds are derived output: they may wait for an exact preview
-- review, while authored publications must still win and make the preview stale.
-- The guard is deliberately inside the activation transaction. A check in the
-- worker before building would leave a race between that check and activation.

create or replace function public.ck_register_preview_access(
  p_release_id uuid,
  p_slug text,
  p_invite_token_hash text,
  p_expires_at timestamptz,
  p_expected_epoch bigint
)
returns void
language plpgsql
set search_path = public
as $$
declare
  target public.ck_releases%rowtype;
  current_epoch bigint;
begin
  select * into target from public.ck_releases where id = p_release_id for update;
  if target.id is null or target.kind <> 'preview' or target.status <> 'preview' then
    raise exception 'preview cannot be registered';
  end if;

  select publish_epoch into current_epoch from public.ck_sites where id = target.site_id for update;
  if current_epoch <> p_expected_epoch or target.base_publish_epoch <> p_expected_epoch then
    raise exception 'stale snapshot: site changed before preview registration (epoch % <> %)',
      current_epoch, p_expected_epoch;
  end if;

  insert into public.ck_preview_access
    (release_id, slug, invite_token_hash, expires_at, consumed_at, session_token_hash, revoked_at, created_at)
  values
    (p_release_id, p_slug, p_invite_token_hash, p_expires_at, null, null, null, now())
  on conflict (slug) do update set
    release_id = excluded.release_id,
    invite_token_hash = excluded.invite_token_hash,
    expires_at = excluded.expires_at,
    consumed_at = null,
    session_token_hash = null,
    revoked_at = null,
    created_at = now();
end;
$$;

create or replace function public.ck_activate_release(
  p_release_id uuid,
  p_revision_ids uuid[] default '{}',
  p_retire_item_ids uuid[] default '{}',
  p_expected_epoch bigint default null
)
returns void
language plpgsql
set search_path = public
as $$
declare
  target public.ck_releases%rowtype;
  current_epoch bigint;
begin
  select * into target from public.ck_releases where id = p_release_id for update;
  if target.id is null or target.kind <> 'release' or target.status not in ('ready', 'active', 'superseded') then
    raise exception 'release cannot be activated';
  end if;
  select publish_epoch into current_epoch from public.ck_sites where id = target.site_id for update;

  if target.reason = 'audio auto-rebuild' and exists (
    select 1
    from public.ck_releases preview
    join public.ck_preview_access access on access.release_id = preview.id
    where preview.site_id = target.site_id
      and preview.kind = 'preview'
      and preview.status = 'preview'
      and preview.base_publish_epoch = current_epoch
      and access.revoked_at is null
      and access.expires_at > now()
  ) then
    raise exception 'derived release deferred: exact preview review is active';
  end if;

  if p_expected_epoch is not null and current_epoch <> p_expected_epoch then
    raise exception 'stale snapshot: site changed since build (epoch % <> %)', current_epoch, p_expected_epoch;
  end if;
  if cardinality(p_revision_ids) > 0 and (
    select count(distinct revision.id) <> cardinality(p_revision_ids)
      or bool_or(item.site_id <> target.site_id)
    from public.ck_content_revisions revision
    join public.ck_content_items item on item.id = revision.item_id
    where revision.id = any(p_revision_ids)
  ) then
    raise exception 'release revisions must all belong to the target site';
  end if;
  if cardinality(p_retire_item_ids) > 0 and (
    select count(distinct item.id) <> cardinality(p_retire_item_ids)
      or bool_or(item.site_id <> target.site_id)
    from public.ck_content_items item
    where item.id = any(p_retire_item_ids)
  ) then
    raise exception 'retired items must all belong to the target site';
  end if;
  if exists (
    select 1
    from public.ck_content_revisions revision
    where revision.id = any(p_revision_ids)
      and revision.item_id = any(p_retire_item_ids)
  ) then
    raise exception 'an item cannot be published and retired in the same release';
  end if;

  update public.ck_releases
    set status = 'superseded'
    where site_id = target.site_id and status = 'active' and id <> target.id;
  update public.ck_releases
    set status = 'active', activated_at = now()
    where id = target.id;
  update public.ck_sites
    set active_release_id = target.id, publish_epoch = publish_epoch + 1, updated_at = now()
    where id = target.site_id;

  if cardinality(p_revision_ids) > 0 then
    update public.ck_content_revisions old
      set status = 'archived'
      from public.ck_content_items item, public.ck_content_revisions fresh
      where fresh.id = any(p_revision_ids)
        and item.id = fresh.item_id
        and old.id = item.published_revision_id
        and old.id <> fresh.id;

    update public.ck_content_revisions
      set status = 'published', published_at = coalesce(published_at, now())
      where id = any(p_revision_ids);

    update public.ck_content_items item
      set published_revision_id = fresh.id, updated_at = now()
      from public.ck_content_revisions fresh
      where fresh.id = any(p_revision_ids) and item.id = fresh.item_id;
  end if;

  if cardinality(p_retire_item_ids) > 0 then
    update public.ck_content_revisions old
      set status = 'archived'
      from public.ck_content_items item
      where item.id = any(p_retire_item_ids)
        and old.id = item.published_revision_id;

    update public.ck_content_revisions
      set status = 'archived'
      where item_id = any(p_retire_item_ids)
        and status = 'scheduled';

    update public.ck_content_items item
      set published_revision_id = null, updated_at = now()
      where item.id = any(p_retire_item_ids)
        and item.published_revision_id is not null;
  end if;
end;
$$;
