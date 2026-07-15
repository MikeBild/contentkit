-- Server-side full-text search over published content.
--   * ck_search_config maps a content locale to a text search configuration
--     (de -> german, en -> english, anything else -> simple). Immutable so it
--     can feed index expressions and the insert trigger.
--   * ck_content_revisions.search_vector is filled by a BEFORE INSERT trigger
--     only — revisions are immutable after insert, so no UPDATE trigger exists.
--     The frontmatter block is stripped from the body before vectorizing, so
--     author-owned `extra` fields never land in the index.
--   * ck_search_published ranks and highlights matches, joining exclusively
--     over published_revision_id — drafts, scheduled and archived revisions
--     are invisible by construction. A NULL locale stems the query with
--     `simple` against locale-stemmed vectors (best-effort cross-locale);
--     with a locale the stemming matches the indexed side exactly.
create or replace function public.ck_search_config(p_locale text)
returns regconfig
language sql
immutable
as $$
  select case
    when p_locale = 'de' or p_locale like 'de-%' then 'german'::regconfig
    when p_locale = 'en' or p_locale like 'en-%' then 'english'::regconfig
    else 'simple'::regconfig
  end;
$$;

alter table public.ck_content_revisions add column if not exists search_vector tsvector;

create or replace function public.ck_search_vector_update()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  doc_locale text;
  config regconfig;
  body text;
begin
  select locale into doc_locale from public.ck_content_items where id = new.item_id;
  config := public.ck_search_config(doc_locale);
  body := regexp_replace(new.markdown, '^---\r?\n.*?\r?\n---(?:\r?\n)?', '');
  new.search_vector :=
       setweight(to_tsvector(config, coalesce(new.title, '')), 'A')
    || setweight(to_tsvector(config, coalesce(new.summary, '')), 'B')
    || setweight(to_tsvector(config, array_to_string(coalesce(new.tags, '{}'), ' ')), 'B')
    || setweight(to_tsvector(config, body), 'D');
  return new;
end;
$$;

drop trigger if exists ck_search_vector_insert on public.ck_content_revisions;
create trigger ck_search_vector_insert
  before insert on public.ck_content_revisions
  for each row execute function public.ck_search_vector_update();

-- Backfill existing revisions (same expression as the trigger).
update public.ck_content_revisions revision
set search_vector =
       setweight(to_tsvector(public.ck_search_config(item.locale), coalesce(revision.title, '')), 'A')
    || setweight(to_tsvector(public.ck_search_config(item.locale), coalesce(revision.summary, '')), 'B')
    || setweight(to_tsvector(public.ck_search_config(item.locale), array_to_string(coalesce(revision.tags, '{}'), ' ')), 'B')
    || setweight(to_tsvector(public.ck_search_config(item.locale), regexp_replace(revision.markdown, '^---\r?\n.*?\r?\n---(?:\r?\n)?', '')), 'D')
from public.ck_content_items item
where item.id = revision.item_id
  and revision.search_vector is null;

create index if not exists ck_content_revisions_search_idx
  on public.ck_content_revisions using gin (search_vector);

create or replace function public.ck_search_published(
  p_site_id uuid,
  p_query text,
  p_locale text default null,
  p_kind text default null,
  p_limit int default 20
)
returns table (
  item_id uuid,
  kind text,
  locale text,
  slug text,
  title text,
  summary text,
  tags text[],
  rank real,
  headline text,
  published_at timestamptz,
  updated_at timestamptz
)
language sql
stable
set search_path = public
as $$
  with query as (
    select websearch_to_tsquery(public.ck_search_config(p_locale), p_query) as ts
  ),
  hits as (
    select item.id as item_id,
           item.kind,
           item.locale,
           revision.slug,
           revision.title,
           revision.summary,
           revision.tags,
           ts_rank(revision.search_vector, query.ts)::real as rank,
           regexp_replace(revision.markdown, '^---\r?\n.*?\r?\n---(?:\r?\n)?', '') as body,
           revision.published_at,
           item.updated_at,
           query.ts
    from public.ck_content_items item
    join public.ck_content_revisions revision on revision.id = item.published_revision_id
    cross join query
    where item.site_id = p_site_id
      and (p_locale is null or item.locale = p_locale)
      and (p_kind is null or item.kind = p_kind)
      and revision.search_vector @@ query.ts
    order by ts_rank(revision.search_vector, query.ts) desc, item.updated_at desc
    limit p_limit
  )
  -- ts_headline is expensive; computing it in a second step keeps it to the
  -- returned page instead of every candidate row.
  select hits.item_id,
         hits.kind,
         hits.locale,
         hits.slug,
         hits.title,
         hits.summary,
         hits.tags,
         hits.rank,
         ts_headline(
           public.ck_search_config(hits.locale),
           hits.title || E'\n' || hits.summary || E'\n' || hits.body,
           hits.ts,
           'StartSel=<mark>,StopSel=</mark>,MaxWords=30'
         ) as headline,
         hits.published_at,
         hits.updated_at
  from hits;
$$;
