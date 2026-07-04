-- Optimistic concurrency for publishing + fixes retire's interaction with
-- scheduled revisions.
--   * ck_sites.publish_epoch is bumped on every activation. A build captures the
--     epoch at snapshot time and passes it as p_expected_epoch; if another publish
--     activated in between, activation is rejected as stale and the caller retries
--     from a fresh snapshot — so a concurrent publish can never silently drop
--     just-published content.
--   * The retire block now also archives an item's *scheduled* revisions, so an
--     unpublished post cannot be resurrected by the next /v1/publish-due run.
alter table public.ck_sites add column if not exists publish_epoch bigint not null default 0;

drop function if exists public.ck_activate_release(uuid, uuid[], uuid[]);

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

    -- Cancel pending scheduled revisions so publish-due cannot resurrect the item.
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
