# Read-aloud audio (Vorlesen)

Contentkit pre-renders a spoken MP3 for every published post: a visitor gets a
native player above the prose, podcast apps get an RSS feed with enclosures,
and the whole pipeline runs asynchronously so publishing never waits for a TTS
provider. This guide covers the full lifecycle and its operational surface.

## Lifecycle

```
publish release ──▶ ck_audio_jobs row (pending)
                      │  worker poll (CONTENTKIT_AUDIO_POLL_MS)
                      ▼
                synthesize (Google Chirp 3 HD → ffmpeg → MP3)
                      │
                      ▼
                content-addressed ck_assets row, served from /media/...
                      │  debounced per site (CONTENTKIT_AUDIO_REBUILD_DEBOUNCE_MS)
                      ▼
                auto-rebuild release ──▶ player + podcast feed live
```

1. **Publish → job.** A successful release with revisions enqueues one job per
   published post revision — if the site has `settings.audio.enabled: true`,
   the post's frontmatter does not say `audio: false`, and the extracted speech
   text is non-empty. Idempotency is `UNIQUE(item_id, speech_sha256)` over the
   *extracted speech text* (frontmatter, code/mermaid fences, the sources
   section, URLs and the series line are dropped), so editing a code block
   never re-synthesizes.
2. **Worker → asset.** A poller (started with `CONTENTKIT_AUDIO_ENABLED=true`;
   requires `ffmpeg` and Google TTS credentials) claims pending jobs with a
   lease, synthesizes the narration and files it as an ordinary
   content-addressed asset. Failures back off exponentially and go terminal
   (`failed`) after `CONTENTKIT_AUDIO_MAX_ATTEMPTS`.
3. **Auto-rebuild.** When a job finishes, the worker schedules a rebuild for
   the site: an internal release with empty `revision_ids` and reason
   `audio auto-rebuild`. The timer is debounced per site (default 60 s,
   `CONTENTKIT_AUDIO_REBUILD_DEBOUNCE_MS`, 1 s–1 h), so a draining backfill
   results in one release, not one per post. Opt out with
   `settings.audio.auto_rebuild: false` and publish manually instead. There is
   no feedback loop: the enqueue hook only fires for releases that carry
   revisions, and auto-rebuilds never do.

## Site settings

Merge into `settings` (a `PATCH` replaces the object wholesale — read first):

```json
{
  "audio": {
    "enabled": true,
    "provider": "google",
    "voice": "de-DE-Chirp3-HD-Charon",
    "monthly_char_budget": 950000,
    "auto_rebuild": true,
    "title": "My Podcast",
    "description": "Narrated posts",
    "author": "Jane Doe",
    "podcast_link": true,
    "podcast_image": "https://example.com/cover-3000.jpg",
    "podcast_category": "Technology"
  }
}
```

Only `enabled` is required; everything else has sensible fallbacks (site name,
site description). A single post opts out with frontmatter `audio: false` —
that wins even over an already-generated asset.

## Backfill the archive

`POST /v1/sites/{site}/audio/backfill` (`release:write`) walks the published
posts newest-first and enqueues jobs for posts whose current speech text has
none yet:

```json
{ "dry_run": true }                          // price the batch, enqueue nothing
{ "limit_chars": 200000 }                    // stop at a character budget
{ "slugs": ["my-post"], "force": true }      // re-render specific posts
```

- `dry_run: true` returns the selected posts, `total_chars` and
  `estimated_usd` without side effects.
- `limit_chars` caps the run (falls back to `monthly_char_budget`, else
  unlimited); the next run resumes where this one stopped.
- `slugs` narrows the walk to specific posts.
- `force: true` resets an existing job even when the speech text is unchanged
  (voice or provider change). The old MP3 stays referenced until the new one
  is done — a live player never 404s — and is deleted at the swap point.

## Delete a narration

`DELETE /v1/content/{item}/audio` (`release:write`) removes every job for the
item and every generated MP3 (storage object and asset row), then schedules an
auto-rebuild (honouring `auto_rebuild`):

```json
{ "item_id": "…", "deleted_jobs": 2, "deleted_assets": 1, "rebuild_scheduled": true }
```

Re-enable later with a backfill (`slugs: ["…"]`). Note that the storage-gc
sweep never touches audio assets — this endpoint and the force-swap cleanup are
the only places narration bytes are reclaimed.

## Monitor jobs

`GET /v1/sites/{site}/audio/jobs` (`content:read`) lists jobs newest-first.
Query `status` filters by `pending`/`processing`/`done`/`failed`/`skipped`
(anything else is a 422); `limit` defaults to 100, capped at 500.

```json
{
  "jobs": [
    { "id": "…", "item_id": "…", "slug": "my-post", "title": "My Post",
      "status": "done", "attempts": 1, "chars": 4211, "error": null,
      "created_at": "…", "updated_at": "…" }
  ],
  "summary": {
    "pending": 0, "processing": 0, "done": 12, "failed": 1, "skipped": 2,
    "chars_this_month": 48211,
    "monthly_char_budget": 950000,
    "budget_remaining": 901789
  }
}
```

`GET /v1/content/{item}/audio` (`content:read`) reports the newest job for a
single item plus the `/media/...` URL and duration once done.

## Budget

`settings.audio.monthly_char_budget` bounds spend per UTC calendar month.
`chars_this_month` sums the characters of every non-skipped job created since
the month began (pending jobs count — they will be billed). Automatic enqueue
on publish refuses a job that would exceed the budget and logs
`audio budget exhausted`; the post simply stays without narration until the
next month or a manual backfill, whose explicit `limit_chars` remains in your
hands.

## Podcast feed

When audio is enabled and at least one indexable post carries a narration, each
locale gets `/{locale}/podcast.xml`: RSS 2.0 with the `itunes:` namespace, one
`<enclosure>` per narrated post, `<language>` from the locale, `itunes:author`,
and — when configured — `itunes:image` (`podcast_image`, an absolute URL;
Apple expects ≥1400×1400) and `itunes:category` (`podcast_category`). The
layout advertises the feed with a `<link rel="alternate">` only when
`settings.audio.podcast_link` is `true`; otherwise you share the URL yourself.

## Frontmatter override

```yaml
---
kind: post
title: My Post
audio: false
---
```

`audio: false` excludes the post from enqueuing, backfill and rendering — no
job, no player, no podcast item — even if an asset already exists.
