/* Data of the account app (VAREL src/lib/api/hooks.ts account part + src/lib/api/privacy.ts customer part).
   TanStack Query over F4's `api` (siteFetch: same-origin cookies, CSRF on writes, the session refresh, `X-Locale`).
   No `meQuery`: the overview's `user` is the single source of the signed-in customer. */
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { localizedPath } from '@/lib/i18n/locales'
import { api } from '@/lib/storefront-api'
import type { AccountOverview, AccountUser, Address, AddressInput, CustomerExport, PreferencesInput, ProfileInput } from '@/lib/types/account'
import { siteFetch } from '@/platform/browser'

/** The overview plus the number of orders (capped at 100: shown as "99+"). */
export type Overview = AccountOverview & { orderCount?: number }

export const accountKeys = {
  all: ['account'] as const,
  overview: ['account', 'overview'] as const,
  addresses: ['account', 'addresses'] as const,
  security: ['account', 'security'] as const,
  countries: ['countries'] as const,
}

export const overviewQuery = queryOptions({
  queryKey: accountKeys.overview,
  queryFn: ({ signal }) => api.get<Overview>('/account/overview', undefined, signal),
  staleTime: 30_000,
})

export const addressesQuery = queryOptions({
  queryKey: accountKeys.addresses,
  queryFn: ({ signal }) => api.get<Address[]>('/account/addresses', undefined, signal),
})

/** Countries the store ships to (WP-11 `GET /site-api/countries`); empty when it cannot answer. */
export const countriesQuery = queryOptions({
  queryKey: accountKeys.countries,
  queryFn: async ({ signal }) => {
    const data = await api.get<string[] | { countries?: string[] }>('/countries', undefined, signal)
    return Array.isArray(data) ? data : (data?.countries ?? [])
  },
  staleTime: 60 * 60_000,
})

/** Whether the account has a password (accounts made by an emailed code have none). Failure → assume yes. */
export const securityQuery = queryOptions({
  queryKey: accountKeys.security,
  queryFn: async ({ signal }) => {
    try {
      const s = await api.get<{ hasPassword?: boolean }>('/auth/two-factor', undefined, signal)
      return { hasPassword: s?.hasPassword !== false }
    } catch {
      return { hasPassword: true }
    }
  },
  staleTime: 5 * 60_000,
})

// ─── Profile and preferences ─────────────────────────────────────────────────

function useSetUser() {
  const qc = useQueryClient()
  return (user: AccountUser) => qc.setQueryData<Overview>(accountKeys.overview, (o) => (o ? { ...o, user } : o))
}

export function useUpdateProfile() {
  const setUser = useSetUser()
  return useMutation({
    mutationFn: (input: ProfileInput) => api.patch<{ user: AccountUser }>('/account/profile', input),
    onSuccess: ({ user }) => setUser(user),
  })
}

export function useUpdatePreferences() {
  const setUser = useSetUser()
  return useMutation({
    mutationFn: (input: PreferencesInput) => api.patch<{ user: AccountUser }>('/account/preferences', input),
    onSuccess: ({ user }) => setUser(user),
  })
}

/** The template's password change (`POST /site-api/auth/change-password`): signs other devices out. */
export function useChangePassword() {
  return useMutation({
    mutationFn: (input: { currentPassword: string; newPassword: string }) =>
      api.post<{ ok: boolean; message?: string }>('/auth/change-password', input),
  })
}

/** The template's email change (`POST /site-api/auth/email`): 202, a confirmation link goes to the new address. */
export function useChangeEmail() {
  return useMutation({
    mutationFn: (input: { email: string; password: string }) => api.post<{ ok: boolean; message?: string }>('/auth/email', input),
  })
}

// ─── Addresses ──────────────────────────────────────────────────────────────

function useInvalidateAddresses() {
  const qc = useQueryClient()
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: accountKeys.addresses }),
      qc.invalidateQueries({ queryKey: accountKeys.overview }),
    ])
}

export function useCreateAddress() {
  const invalidate = useInvalidateAddresses()
  return useMutation({
    mutationFn: (input: AddressInput) => api.post<Address>('/account/addresses', input),
    onSuccess: invalidate,
  })
}

export function useUpdateAddress() {
  const invalidate = useInvalidateAddresses()
  return useMutation({
    mutationFn: ({ id, ...input }: Partial<AddressInput> & { id: string }) =>
      api.patch<Address>(`/account/addresses/${encodeURIComponent(id)}`, input),
    onSuccess: invalidate,
  })
}

export function useDeleteAddress() {
  const invalidate = useInvalidateAddresses()
  return useMutation({
    mutationFn: (id: string) => api.del<void>(`/account/addresses/${encodeURIComponent(id)}`),
    onSuccess: invalidate,
  })
}

// ─── Data and privacy ───────────────────────────────────────────────────────

/** Save a JSON document as a file download. */
export function saveJson(data: unknown, filename: string): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const today = () => new Date().toISOString().slice(0, 10)

/** GET /site-api/account/export → downloads varel-data-<date>.json */
export function useExportMyData() {
  return useMutation({
    mutationFn: () => api.get<CustomerExport>('/account/export'),
    onSuccess: (data) => saveJson(data, `varel-data-${today()}.json`),
  })
}

/** POST /site-api/account/delete {password, confirm}: the account is closed and signed out; then a full page
    load of the home page (the header, bag and wishlist start over). */
export function useDeleteMyAccount(locale: string) {
  return useMutation({
    mutationFn: (input: { password: string; confirm: string }) => api.post<{ ok: boolean; message?: string }>('/account/delete', input),
    onSuccess: () => {
      window.location.replace(localizedPath('/', locale))
    },
  })
}

/** Sign out (the template's logout; errors ignored), then the sign-in page with a full load. */
export function useSignOut() {
  return useMutation({
    mutationFn: async () => {
      await siteFetch('/site-api/auth/logout', { method: 'POST' }).catch(() => null)
    },
    onSettled: () => {
      window.location.replace('/account/login/')
    },
  })
}

/** A short-lived link to a purchased file (JSON mode of the download route), then the browser follows it. */
export function useDownload() {
  return useMutation({
    mutationFn: (file: string) =>
      api.get<{ url: string; expiresAt: string }>(`/downloads/${encodeURIComponent(file)}`, { format: 'json' }),
    onSuccess: ({ url }) => {
      window.location.assign(url)
    },
  })
}
