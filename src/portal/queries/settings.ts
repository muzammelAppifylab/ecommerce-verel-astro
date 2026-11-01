import type {QueryClient} from '@tanstack/react-query';

/**
 * Store settings (`/dashboard/settings/*`). WP-23 owns this file
 * (`/site-api/manage/{settings,tax-rates,shipping,payments}`). The sections and
 * their sub-nav are `SETTINGS_NAV` (VAREL `components/admin/settings-nav.ts`);
 * Emails is WP-22's (`queries/emails.ts`), Languages WP-25's (`queries/languages.ts`).
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

/** WP-23 implements. */
export const loadSettings = (_queryClient: QueryClient, _section: SettingsSection): Promise<void> => Promise.resolve();
