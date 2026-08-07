import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'

// ContentKit serves this bundle itself, so the build output lands in the very
// directory `build-binary.sh` already tars into the payload. Nothing about the
// Cockpit needs a second process or a second deployment.
const API_ORIGIN = process.env.CONTENTKIT_DEV_ORIGIN || 'http://127.0.0.1:4050'

// The dev server has to look like the API origin to the browser *and* to
// ContentKit: same origin so the session cookie and CSRF token apply, and
// `changeOrigin` so isApiHost() still recognises the Host header — without it
// every /v1 route answers 404.
const proxy = Object.fromEntries(
  ['/v1', '/public', '/openapi.json', '/health', '/ready'].map((path) => [
    path,
    { target: API_ORIGIN, changeOrigin: true },
  ]),
)

/**
 * The contract marker, DERIVED rather than typed — CUI-MARK-1.
 *
 * Two meta tags in the served document: which contract this console implements,
 * and a digest of the token bytes it implements it with, computed at build time
 * from `contract/cockpit-ui.css` — the same file the offline contract test
 * compares `index.css` against.
 *
 * Derived is the whole point. The family's earlier marker was a hand-typed
 * version number, and four repositories could each keep claiming version 2 while
 * their bytes drifted apart; a number somebody types cannot notice. A digest can
 * only agree when the bytes agree, so two products serving different colours
 * announce different strings — in the DOM, in every screenshot, without anybody
 * having to run a comparison.
 *
 * No test inside one repository can prove its bytes match an absent sibling's.
 * What this buys is that the divergence is VISIBLE instead of silent.
 */
function contractMeta(): Plugin {
  return {
    name: 'contentkit-cockpit-contract-meta',
    transformIndexHtml(html) {
      const css = readFileSync(fileURLToPath(new URL('../../contract/cockpit-ui.css', import.meta.url)), 'utf8')
      const digest = createHash('sha256').update(css).digest('hex').slice(0, 12)
      return html.replace(
        '</head>',
        `  <meta name="cockpit-ui-contract" content="cockpit-ui" />\n` +
          `    <meta name="cockpit-ui-digest" content="sha256-${digest}" />\n  </head>`,
      )
    },
  }
}

export default defineConfig({
  base: '/cockpit/',
  plugins: [react(), tailwind(), contractMeta()],
  // `@/` spelled out here rather than left to tsconfig `paths`. `vite build`
  // resolves those on its own, so this file got away without the alias — but the
  // dev server's import-analysis pass does not, and `npm run dev` has therefore
  // been failing on the very first import in main.tsx while every build and
  // every test stayed green. vitest.config.ts already declares this exact alias
  // for the same reason; this is the third consumer finally saying it too.
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // assets/composition.js and assets/site.css live in the repository root: the
  // console shares the published site's implementation rather than copying it,
  // so the dev server has to be allowed to read one level above this app.
  server: { port: 4051, proxy, fs: { allow: ['..', '../..'] } },
  build: {
    outDir: '../../assets/cockpit',
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      output: {
        // Splitting the heavy dependencies keeps the first Cockpit paint out of
        // their download path and keeps the payload's growth legible in the
        // build output. Mermaid and the Markdown parser matter most: neither is
        // needed until content is on screen, and Mermaid only when a diagram is.
        manualChunks: (id: string) => {
          // Mermaid's own diagram implementations stay where Mermaid put them:
          // it imports each one on demand, and pulling them into this chunk
          // would download every diagram kind to draw a single flowchart.
          if (id.includes('node_modules/mermaid/') && !id.includes('/chunks/')) return 'mermaid'
          if (/node_modules\/(react-markdown|remark-|mdast-|micromark|unist-|unified|vfile|hast-|character-)/.test(id))
            return 'markdown'
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) return 'react'
          if (id.includes('node_modules/@tanstack')) return 'tanstack'
          return undefined
        },
      },
    },
  },
})
