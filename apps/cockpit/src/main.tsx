import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { queryClient } from '@/lib/query'
import { router } from '@/router'
import { SessionGate } from '@/lib/session'
import { SiteProvider } from '@/lib/site'

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* Nothing renders until the session is known: the console never shows a
          half-authenticated shell, and every child may assume a principal. */}
      <SessionGate>
        <SiteProvider>
          <RouterProvider router={router} />
        </SiteProvider>
      </SessionGate>
    </QueryClientProvider>
  </StrictMode>,
)
