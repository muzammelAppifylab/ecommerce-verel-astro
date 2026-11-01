import {type QueryClient, queryOptions, useMutation, useQueryClient} from '@tanstack/react-query';

import type {
  AdminPaymentsStatus,
  AdminShippingMethod,
  AdminShippingZone,
  AdminTaxRate,
  MethodInput,
  StoreSettings,
  StoreSettingsInput,
  TaxRateInput,
  ZoneInput,
} from '../../lib/types/admin/store';
import {manage} from '../api';

/**
 * Store settings (`/dashboard/settings/*`). WP-23 owns this file
 * (`/site-api/manage/{settings,tax-rates,shipping,payments}`). The sections and
 * their sub-nav are `SETTINGS_NAV` (VAREL `components/admin/settings-nav.ts`);
 * Emails is WP-22's (`queries/emails.ts`), Languages WP-25's (`queries/languages.ts`).
 *
 * Port of VAREL `src/lib/admin/store.ts` + `pages/admin/settings/tax-rates.ts`. Other
 * screens read the settings through `settingsQuery` and save through
 * `useUpdateSettings()` (reviews, home hero, analytics, emails, abandoned bags, languages).
 */

export type SettingsSection = 'general' | 'checkout' | 'payments' | 'tax' | 'shipping' | 'inventory' | 'emails' | 'languages' | 'privacy' | 'seo';

/** The ability a section needs (hidden without it). General has none: without `manageStoreSettings` it shows read-only. */
export type SettingsAbility = 'manageStoreSettings' | 'manageContent';

export interface SettingsNavItem {
  section: SettingsSection;
  group: 'Store' | 'Customers';
  label: string;
  /** A portal path (literal, as in routes.tsx). */
  to:
    | '/settings'
    | '/settings/checkout'
    | '/settings/payments'
    | '/settings/tax'
    | '/settings/shipping'
    | '/settings/inventory'
    | '/settings/emails'
    | '/settings/languages'
    | '/settings/privacy'
    | '/settings/seo';
  description: string;
  ability?: SettingsAbility;
}

export const SETTINGS_NAV: readonly SettingsNavItem[] = [
  {section: 'general', group: 'Store', label: 'General', to: '/settings', description: 'Store name, contact, legal details, logo, social links, order numbers'},
  {section: 'checkout', group: 'Store', label: 'Checkout', to: '/settings/checkout', description: 'Guest checkout, phone, order notes, terms', ability: 'manageStoreSettings'},
  {section: 'payments', group: 'Store', label: 'Payments', to: '/settings/payments', description: 'Stripe or simulated payments', ability: 'manageStoreSettings'},
  {section: 'tax', group: 'Store', label: 'Tax and currency', to: '/settings/tax', description: 'Currency, prices with or without tax, rates by country', ability: 'manageStoreSettings'},
  {section: 'shipping', group: 'Store', label: 'Shipping', to: '/settings/shipping', description: 'Zones, delivery methods and rates', ability: 'manageStoreSettings'},
  {section: 'inventory', group: 'Store', label: 'Inventory and returns', to: '/settings/inventory', description: 'Low stock, sold-out products, return window and reasons', ability: 'manageStoreSettings'},
  {section: 'emails', group: 'Customers', label: 'Emails', to: '/settings/emails', description: 'Email templates, sent log, provider and sender', ability: 'manageStoreSettings'},
  {section: 'languages', group: 'Customers', label: 'Languages', to: '/settings/languages', description: 'Storefront languages and every translation', ability: 'manageContent'},
  {section: 'privacy', group: 'Customers', label: 'Customers and privacy', to: '/settings/privacy', description: 'Cookie consent, reviews, analytics, abandoned bags', ability: 'manageStoreSettings'},
  {section: 'seo', group: 'Customers', label: 'SEO', to: '/settings/seo', description: 'Default title, description and share image', ability: 'manageStoreSettings'},
];

// ─── Reads ────────────────────────────────────────────────────────────────────

export const settingsKeys = {
  settings: ['manage', 'settings'] as const,
  taxRates: ['manage', 'tax-rates'] as const,
  shipping: ['manage', 'shipping'] as const,
  paymentsStatus: ['manage', 'payments', 'status'] as const,
};

/** GET /site-api/manage/settings: every settings field (any staff may read). */
export const settingsQuery = queryOptions({
  queryKey: settingsKeys.settings,
  queryFn: ({signal}) => manage<StoreSettings>('settings', {signal}),
  staleTime: 30_000,
});

/** GET /site-api/manage/tax-rates: country rates, sorted by country. */
export const taxRatesQuery = queryOptions({
  queryKey: settingsKeys.taxRates,
  queryFn: ({signal}) => manage<AdminTaxRate[]>('tax-rates', {signal}),
  staleTime: 30_000,
});

/** GET /site-api/manage/shipping: zones with their methods. */
export const shippingQuery = queryOptions({
  queryKey: settingsKeys.shipping,
  queryFn: ({signal}) => manage<AdminShippingZone[]>('shipping', {signal}),
  staleTime: 30_000,
});

/** GET /site-api/manage/payments/status (needs `manageStoreSettings`). */
export const paymentsStatusQuery = queryOptions({
  queryKey: settingsKeys.paymentsStatus,
  queryFn: ({signal}) => manage<AdminPaymentsStatus>('payments/status', {signal}),
});

/** Warms what a settings section reads before it renders (routes.tsx `settingsLoader`). */
export const loadSettings = async (queryClient: QueryClient, section: SettingsSection): Promise<void> => {
  const reads: Promise<unknown>[] = [queryClient.ensureQueryData(settingsQuery)];
  if (section === 'tax') reads.push(queryClient.ensureQueryData(taxRatesQuery));
  if (section === 'shipping') reads.push(queryClient.ensureQueryData(shippingQuery));
  // Payments status needs the settings ability (403 otherwise): the screen queries it itself.
  await Promise.all(reads);
};

// ─── Writes ───────────────────────────────────────────────────────────────────

/** PATCH /site-api/manage/settings with only the fields that changed. */
export const updateSettings = (patch: StoreSettingsInput) => manage<StoreSettings>('settings', {method: 'PATCH', body: patch});

/** Saves settings; the answer (the fresh settings) replaces the cached copy. */
export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: updateSettings,
    onSuccess: data => {
      qc.setQueryData(settingsKeys.settings, data);
      void qc.invalidateQueries({queryKey: settingsKeys.paymentsStatus});
    },
  });
}

function useInvalidating<V, R>(key: readonly string[], fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => qc.invalidateQueries({queryKey: key}),
  });
}

const enc = encodeURIComponent;

export const useCreateTaxRate = () =>
  useInvalidating(settingsKeys.taxRates, (body: TaxRateInput) => manage<AdminTaxRate>('tax-rates', {method: 'POST', body}));

export const useUpdateTaxRate = () =>
  useInvalidating(settingsKeys.taxRates, ({id, ...body}: Partial<TaxRateInput> & {id: string}) =>
    manage<AdminTaxRate>(`tax-rates/${enc(id)}`, {method: 'PATCH', body})
  );

export const useDeleteTaxRate = () =>
  useInvalidating(settingsKeys.taxRates, (id: string) => manage<null>(`tax-rates/${enc(id)}`, {method: 'DELETE'}));

export const useCreateZone = () =>
  useInvalidating(settingsKeys.shipping, (body: ZoneInput) => manage<AdminShippingZone>('shipping/zones', {method: 'POST', body}));

export const useUpdateZone = () =>
  useInvalidating(settingsKeys.shipping, ({id, ...body}: Partial<ZoneInput> & {id: string}) =>
    manage<AdminShippingZone>(`shipping/zones/${enc(id)}`, {method: 'PATCH', body})
  );

export const useDeleteZone = () =>
  useInvalidating(settingsKeys.shipping, (id: string) => manage<null>(`shipping/zones/${enc(id)}`, {method: 'DELETE'}));

export const useCreateMethod = () =>
  useInvalidating(settingsKeys.shipping, ({zoneId, ...body}: MethodInput & {zoneId: string}) =>
    manage<AdminShippingMethod>(`shipping/zones/${enc(zoneId)}/methods`, {method: 'POST', body})
  );

export const useUpdateMethod = () =>
  useInvalidating(settingsKeys.shipping, ({id, ...body}: Partial<MethodInput> & {id: string}) =>
    manage<AdminShippingMethod>(`shipping/methods/${enc(id)}`, {method: 'PATCH', body})
  );

export const useDeleteMethod = () =>
  useInvalidating(settingsKeys.shipping, (id: string) => manage<null>(`shipping/methods/${enc(id)}`, {method: 'DELETE'}));
