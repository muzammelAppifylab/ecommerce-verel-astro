/* Staff permission areas on the client (VAREL src/lib/admin/permissions.ts, labels and help copied verbatim).
   Areas come from template roles here (src/server/permissions.ts `areasOf`); a person's mix of areas is the
   union of their roles' areas. */
import type {PermissionArea, StaffRoleOption} from '../../../lib/types/admin/staff';

export type {PermissionArea};

export const PERMISSION_AREAS: PermissionArea[] = ['orders', 'customers', 'products', 'content', 'discounts', 'analytics', 'settings', 'staff'];

export const AREA_LABEL: Record<PermissionArea, string> = {
  orders: 'Orders',
  customers: 'Customers',
  products: 'Products',
  content: 'Content',
  discounts: 'Discounts',
  analytics: 'Analytics',
  settings: 'Settings',
  staff: 'Staff',
};

export const AREA_HELP: Record<PermissionArea, string> = {
  orders: 'Orders, returns, refunds and abandoned bags',
  customers: 'Customer accounts, their history and newsletter subscribers',
  products: 'Products, inventory, departments, collections and reviews',
  content: 'Journal, pages, navigation and translations',
  discounts: 'Discounts and discount codes',
  analytics: 'Analytics and reports',
  settings: 'Store settings, shipping, tax, emails and payments',
  staff: 'Staff, invites and the activity log',
};

/** Roles the checklists offer: never `owner` (set by the owner emails) or `member` (every customer). */
export const checklistRoles = (roles: StaffRoleOption[]) => roles.filter(r => r.slug !== 'owner' && r.slug !== 'member' && r.areas.length > 0);

/** The union of the chosen roles' areas, in canonical order. */
export function areasOfRoles(chosen: readonly string[], roles: readonly StaffRoleOption[]): PermissionArea[] {
  const set = new Set<PermissionArea>();
  for (const slug of chosen) for (const a of roles.find(r => r.slug === slug)?.areas ?? []) set.add(a);
  return PERMISSION_AREAS.filter(a => set.has(a));
}

/** The summary line under the checklist. */
export function accessSummary(areas: readonly PermissionArea[]): string {
  if (!areas.length) return 'Choose at least one role with store access.';
  if (areas.length === PERMISSION_AREAS.length) return 'Full access: every area of the admin.';
  return `${areas.length} of ${PERMISSION_AREAS.length} areas: ${areas.map(a => AREA_LABEL[a]).join(', ')}.`;
}

export const NO_ROLE = 'Choose at least one role with store access';

/** Mirrors the server's `emailField` (src/server/lib/validate.ts). */
export function emailProblem(value: string): string | null {
  const v = value.trim();
  if (!v) return 'Enter your email address';
  if (v.length > 254) return 'That email address is too long';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'Enter a valid email address';
  return null;
}
