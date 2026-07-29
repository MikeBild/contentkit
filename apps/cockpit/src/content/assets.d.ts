/**
 * assets/composition.js lives outside this app: it is the file the published
 * page runs, imported here so both surfaces enhance composition markup with one
 * implementation. It has no build step and therefore no declaration file, so its
 * one export is declared instead of the module being wrapped or copied.
 */
declare module '*/assets/composition.js' {
  export function enhanceComposition(root?: ParentNode): void
}
