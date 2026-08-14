-- A reviewed preview can only be published safely when ContentKit can prove
-- that the activated bytes are the exact immutable snapshot the reviewer saw.
-- Store the snapshot's optimistic-concurrency base, retirement overlay and a
-- canonical digest of every rendered entry. Promotion rejects an epoch or
-- digest mismatch instead of rebuilding a look-alike release.
alter table public.ck_releases
  add column if not exists base_publish_epoch bigint,
  add column if not exists retire_item_ids uuid[] not null default '{}',
  add column if not exists manifest_sha256 text;

alter table public.ck_releases
  drop constraint if exists ck_releases_manifest_sha256_check;
alter table public.ck_releases
  add constraint ck_releases_manifest_sha256_check
  check (manifest_sha256 is null or manifest_sha256 ~ '^[0-9a-f]{64}$');
