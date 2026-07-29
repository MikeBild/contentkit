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
  server: { port: 4051, proxy },
  build: {
    outDir: '../../assets/cockpit',
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      output: {
        // Monaco and the chat runtime are the two heavy chunks; splitting them
        // keeps the first Cockpit paint out of their download path and keeps
        // the payload's growth legible in the build output.
        manualChunks: (id: string) => {
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) return 'react'
          if (id.includes('node_modules/@tanstack')) return 'tanstack'
          return undefined
        },
      },
    },
  },
})
