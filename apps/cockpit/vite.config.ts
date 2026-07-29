import { defineConfig } from 'vite'
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

export default defineConfig({
  base: '/cockpit/',
  plugins: [react(), tailwind()],
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
