-- Reference-reuse dedup: a release entry may point at a prior release's
-- storage object instead of a fresh upload. cache_control joins the dedup key
-- because it is an upload-time property of the stored object; the storage_path
-- index serves the GC anti-join that keeps shared objects alive.
alter table public.ck_release_entries add column if not exists cache_control text;
--> statement-breakpoint
create index if not exists ck_release_entries_storage_path_idx
  on public.ck_release_entries (storage_path);
