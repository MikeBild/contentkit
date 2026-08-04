/**
 * "No filter", as a value Radix will accept.
 *
 * A `SelectItem` may not carry an empty value — Radix reserves it for "nothing
 * selected" and throws on it — while every filter in the console means "no
 * filter" by the empty string. The sentinel therefore lives between the trigger
 * and `onValueChange` and nowhere else: the state and the requests built from it
 * are unchanged. The leading underscores keep it outside every enum that uses it.
 *
 * It is here rather than at the top of each page because it was three identical
 * declarations across the pages this module was split out of, and a sentinel that
 * is spelled differently in two files is a filter that stops clearing in one.
 */
export const ANY = '__any'
