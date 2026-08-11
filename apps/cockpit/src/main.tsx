import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { queryClient } from '@/lib/query'
import { router } from '@/router'
import { SessionGate } from '@/components/session-gate'
import { I18nProvider } from '@/lib/i18n-context'

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
      {/* Nothing renders until the session is known: the console never shows a
          half-authenticated shell, and every child may assume a principal.
          The site provider lives inside the router — it carries the selection
          in `?site=`, which means it needs the router's search params. */}
      <SessionGate>
        <RouterProvider router={router} />
      </SessionGate>
      </QueryClientProvider>
    </I18nProvider>
  </StrictMode>,
)
