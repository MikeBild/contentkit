// The published page's entry point. composition.js is a module so the console
// can enhance a subtree; a page enhances the whole document, and this is the
// one line that says so.
import { enhanceComposition } from './composition.js'

enhanceComposition()
