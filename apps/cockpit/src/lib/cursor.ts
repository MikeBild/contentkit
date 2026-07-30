/**
 * Where a cursor-paged list is, and how it gets back.
 *
 * The paged endpoints answer `{ items, next_cursor }` (see `PublishedList` in
 * docs/openapi.json) and that is all: no total, no page count, and no cursor for
 * the page before this one. Two consequences shape everything here.
 *
 * A page number cannot be a control. An opaque keyset cursor makes "page 7"
 * unaddressable, so a numbered pager would offer a jump the server cannot make;
 * the number below is a position the operator has walked to, printed as a fact,
 * never as a link.
 *
 * "Previous" cannot be asked for, only remembered. `seen` is that memory — the
 * cursors already spent, oldest first — and it is the reason this state is a
 * value rather than two `useState` calls in a page.
 */

export interface CursorPage {
  /** The cursor this page was fetched with. `null` is the first page. */
  cursor: string | null
  /** The cursors of the pages before it, oldest first. */
  seen: readonly (string | null)[]
}

export const firstPage: CursorPage = { cursor: null, seen: [] }

/**
 * Forward, if the response said there is a forward.
 *
 * Both guards return the state unchanged, by identity, so a caller can compare
 * and skip a refetch. The second one is not theoretical: `next_cursor` stays put
 * until the new response lands, so a second click on Next — or a keyboard repeat
 * — would otherwise push the same cursor twice and make Previous walk back
 * through a page the operator never saw.
 */
export function nextPage(page: CursorPage, nextCursor: string | null | undefined): CursorPage {
  if (!nextCursor) return page
  if (nextCursor === page.cursor) return page
  return { cursor: nextCursor, seen: [...page.seen, page.cursor] }
}

/** Back to the cursor this page came from. The first page has nowhere to go. */
export function previousPage(page: CursorPage): CursorPage {
  if (page.seen.length === 0) return page
  return { cursor: page.seen[page.seen.length - 1] ?? null, seen: page.seen.slice(0, -1) }
}

export function hasPrevious(page: CursorPage): boolean {
  return page.seen.length > 0
}

/** Whether the *response* offers a next page. The state cannot know this on its own. */
export function hasNext(nextCursor: string | null | undefined): boolean {
  return Boolean(nextCursor)
}

/** How deep the operator has walked, counting from 1. */
export function pageNumber(page: CursorPage): number {
  return page.seen.length + 1
}

/**
 * Back to the start, for a filter change.
 *
 * A cursor belongs to the query that produced it, so keeping one across a new
 * `kind` or `locale` filter either 404s or — worse, and this is what keyset
 * pagination does — silently answers from the middle of a different list.
 */
export function resetPage(): CursorPage {
  return firstPage
}
