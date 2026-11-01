/* The customer account app (PLAN.md D6): one React island (`client:only`) on src/pages/account/[...path].astro,
   storefront look, TanStack Router under `/account` (or `/da/account`…) and TanStack Query over the Site API.
   The host page passes the words (one dictionary for ACCOUNT_NAMESPACES), the language, the router base, the
   store name and the overview it already read (no loading flash on the first screen). */
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { useState } from 'react'
import type { Dictionary } from '@/lib/i18n/core'
import { loginLink } from '@/lib/links'
import { ApiError } from '@/lib/storefront-api'
import { AccountProvider } from './i18n'
import { accountKeys, type Overview } from './queries'
import { createAccountRouter } from './router'

export interface AccountAppProps {
  dict: Dictionary
  locale: string
  /** `/account` or `/da/account` (no trailing slash) */
  basepath: string
  siteName?: string
  initialOverview?: Overview | null
}

/** A signed-out answer anywhere sends the visitor to sign in, back here afterwards (VAREL AccountGuard). */
function onSignedOut(error: unknown) {
  if (!(error instanceof ApiError) || error.status !== 401) return
  if (typeof window === 'undefined') return
  window.location.replace(loginLink(window.location.pathname + window.location.search))
}

function makeQueryClient(initial: Overview | null | undefined) {
  const qc = new QueryClient({
    queryCache: new QueryCache({ onError: onSignedOut }),
    mutationCache: new MutationCache({ onError: onSignedOut }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // One retry for a network blip; never for an answer the server meant (401, 403, 404, 422…).
        retry: (count, error) => count < 1 && !(error instanceof ApiError && error.status > 0 && error.status < 500),
      },
    },
  })
  if (initial) qc.setQueryData(accountKeys.overview, initial, { updatedAt: Date.now() })
  return qc
}

export default function AccountApp({ dict, locale, basepath, siteName = 'VAREL', initialOverview }: AccountAppProps) {
  const [queryClient] = useState(() => makeQueryClient(initialOverview))
  const [router] = useState(() => createAccountRouter(queryClient, basepath))
  const [context] = useState(() => ({ dict, locale, basepath, siteName }))
  return (
    <AccountProvider value={context}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </AccountProvider>
  )
}
