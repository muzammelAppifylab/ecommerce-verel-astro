import {
  abilitiesOf,
  type AbilitiesOf,
  codenamesOf,
  CORE_PERMISSIONS,
  definePermissions,
  scopeOf,
} from '../platform/auth/codenames';

/**
 * THE permission catalogue: every codename this site checks, declared ONCE.
 * Adding an entry here is the whole job (docs/agent/roles-and-permissions.md):
 *
 *   - `PERMISSIONS.<KEY>` is its codename, for `requirePermission` / `can`;
 *   - `ability` adds a flag to `/me` `abilities` (and to the `Abilities` type)
 *     for the UI: portal nav items, buttons, `pageContext()` pages;
 *   - the row reaches the `permissions` table (the roles screen) on the next
 *     signed-in request after deploy, and `roles` get it that first time only
 *     (`src/platform/permission-sync.ts`). No migration.
 *
 * VAREL's staff permission AREAS (worker/middleware/permissions.ts) are one entry each
 * (docs/migration/PLAN.md §7). The `staff` role is created by F1's migration (same deploy),
 * so the `roles: ['admin', 'staff']` defaults reach it on the first sync. Owners hold `*`;
 * customers are `member` and get nothing here. Per-staff area restriction = a custom role
 * in `/dashboard/roles`.
 *
 * Never rename or reuse a shipped codename: roles hold it by name. Browser-safe
 * (no server imports): the portal reads the `Abilities` type and the area table from here.
 */
export const CATALOGUE = definePermissions({
  ...CORE_PERMISSIONS,
  /** VAREL area `orders`: orders, returns, abandoned bags. */
  SHOP_ORDER_MANAGE: {
    codename: 'site:shop_order:manage',
    title: 'Manage orders',
    description: 'See and fulfil orders, refund them, handle returns and abandoned bags.',
    group: 'Store',
    ability: 'manageOrders',
    roles: ['admin', 'staff'],
  },
  /** VAREL area `customers`: customers and newsletter subscribers. */
  CUSTOMER_MANAGE: {
    codename: 'site:customer:manage',
    title: 'Manage customers',
    description: 'See customers and their orders, export or delete their data, manage newsletter subscribers.',
    group: 'Store',
    ability: 'manageCustomers',
    roles: ['admin', 'staff'],
  },
  /** VAREL area `products`: products, inventory, catalog, collections, reviews. */
  PRODUCT_MANAGE: {
    codename: 'site:product:manage',
    title: 'Manage products',
    description: 'Edit products, variants, inventory, departments, collections and product reviews.',
    group: 'Store',
    ability: 'manageProducts',
    roles: ['admin', 'staff'],
  },
  /** VAREL area `content`: journal, pages, navigation, translations. */
  CONTENT_MANAGE: {
    codename: 'site:content:manage',
    title: 'Manage content',
    description: 'Write journal posts and pages, edit the navigation menus and translations.',
    group: 'Store',
    ability: 'manageContent',
    roles: ['admin', 'staff'],
  },
  /** VAREL area `discounts`: discounts, codes and their reports. */
  DISCOUNT_MANAGE: {
    codename: 'site:discount:manage',
    title: 'Manage discounts',
    description: 'Create discounts and codes, and see how each one performs.',
    group: 'Store',
    ability: 'manageDiscounts',
    roles: ['admin', 'staff'],
  },
  /** VAREL area `analytics`. */
  ANALYTICS_READ: {
    codename: 'site:analytics:read',
    title: 'See analytics',
    description: 'See sales, traffic, the conversion funnel and searches.',
    group: 'Store',
    ability: 'viewAnalytics',
    roles: ['admin', 'staff'],
  },
  /** VAREL area `settings`: store details, tax, shipping, payments, emails, languages. */
  STORE_SETTINGS_MANAGE: {
    codename: 'site:store_settings:manage',
    title: 'Manage store settings',
    description: 'Change store details, tax rates, shipping, payments, emails and languages.',
    group: 'Store',
    ability: 'manageStoreSettings',
    roles: ['admin'],
  },
});

/** Codenames by key: `PERMISSIONS.PRODUCT_MANAGE` is `'site:product:manage'`. */
export const PERMISSIONS = codenamesOf(CATALOGUE);

export type Codename = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** What the UI may SHOW the visitor (`/me`); every route checks again. */
export type Abilities = AbilitiesOf<typeof CATALOGUE>;

/** The abilities a set of granted codenames gives (`/me`). */
export const abilitiesFor = (permissions: ReadonlySet<string>): Abilities => abilitiesOf(CATALOGUE, permissions);

/** A guest's abilities: every flag false. */
export const NO_ABILITIES: Abilities = abilitiesFor(new Set());

// ─── VAREL admin areas (worker/middleware/permissions.ts) ────────────────────────────────

/** VAREL's staff permission areas, in canonical order. */
export const PERMISSION_AREAS = ['orders', 'customers', 'products', 'content', 'discounts', 'analytics', 'settings', 'staff'] as const;
export type PermissionArea = (typeof PERMISSION_AREAS)[number];

/** The codename that grants each area. `staff` is the template's user admin (`site:user:*`). */
export const AREA_CODENAMES: Readonly<Record<PermissionArea, Codename>> = {
  orders: PERMISSIONS.SHOP_ORDER_MANAGE,
  customers: PERMISSIONS.CUSTOMER_MANAGE,
  products: PERMISSIONS.PRODUCT_MANAGE,
  content: PERMISSIONS.CONTENT_MANAGE,
  discounts: PERMISSIONS.DISCOUNT_MANAGE,
  analytics: PERMISSIONS.ANALYTICS_READ,
  settings: PERMISSIONS.STORE_SETTINGS_MANAGE,
  staff: PERMISSIONS.USER_READ,
};

/** The ability flag of each area (portal nav, buttons). */
export const AREA_ABILITIES = {
  orders: 'manageOrders',
  customers: 'manageCustomers',
  products: 'manageProducts',
  content: 'manageContent',
  discounts: 'manageDiscounts',
  analytics: 'viewAnalytics',
  settings: 'manageStoreSettings',
  staff: 'manageUsers',
} as const satisfies Record<PermissionArea, keyof Abilities>;

/** The areas a set of granted codenames gives (wildcards included). */
export function areasOf(permissions: ReadonlySet<string>): PermissionArea[] {
  return PERMISSION_AREAS.filter(area => scopeOf(permissions, AREA_CODENAMES[area]) === 'all');
}

/** The areas the UI may show, from `/me` abilities (portal: Overview shows for any area). */
export function areasFromAbilities(abilities: Partial<Abilities> | null | undefined): PermissionArea[] {
  return PERMISSION_AREAS.filter(area => Boolean(abilities?.[AREA_ABILITIES[area]]));
}

/** `any` = any staff member (holds at least one area). An area list means "any one of these". */
export type AreaNeed = 'any' | readonly PermissionArea[];
export interface AreaRule {
  /** Needed for POST/PATCH/PUT/DELETE. */
  write: AreaNeed;
  /** Needed for GET/HEAD (defaults to `write`). */
  read?: AreaNeed;
}

/**
 * `/site-api/manage/<segment>` → the area it needs (VAREL `ADMIN_AREAS`, keyed by the module's
 * mount segment in `src/server/routes/admin/index.ts`). Checked centrally for every manage
 * request; an unmapped segment needs every area. Keep in step with the portal's NAV_GROUPS.
 */
export const MANAGE_AREAS: Readonly<Record<string, AreaRule>> = {
  dashboard: {write: 'any'},
  // Sales
  orders: {write: ['orders']},
  returns: {write: ['orders']},
  abandoned: {write: ['orders']},
  customers: {write: ['customers']},
  subscribers: {write: ['customers']},
  // Catalog (the discount editor reads products and collections to pick targets)
  products: {write: ['products'], read: ['products', 'discounts']},
  inventory: {write: ['products']},
  taxonomy: {write: ['products'], read: 'any'},
  collections: {write: ['products'], read: ['products', 'discounts']},
  reviews: {write: ['products']},
  uploads: {write: ['products', 'content', 'settings']},
  // Content
  posts: {write: ['content']},
  pages: {write: ['content']},
  menus: {write: ['content']},
  translations: {write: ['content']},
  // Growth
  discounts: {write: ['discounts']},
  analytics: {write: ['analytics']},
  // Store (reads stay open to staff: other screens show the currency, rates and shipping)
  settings: {write: ['settings'], read: 'any'},
  'tax-rates': {write: ['settings'], read: 'any'},
  shipping: {write: ['settings'], read: 'any'},
  emails: {write: ['settings']},
  payments: {write: ['settings']},
  // People
  staff: {write: ['staff']},
  activity: {write: ['staff']},
};

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** The areas a manage request needs: `'any'`, a list, or `null` for an unmapped segment (every area). */
export function areaFor(method: string, managePath: string): AreaNeed | null {
  const segment = managePath.replace(/^\/+/, '').split('/')[0]?.toLowerCase() ?? '';
  const rule = Object.hasOwn(MANAGE_AREAS, segment) ? MANAGE_AREAS[segment] : undefined;
  if (!rule) return null;
  return READ_METHODS.has(method.toUpperCase()) ? (rule.read ?? rule.write) : rule.write;
}

/** May someone holding `permissions` make this manage request? (VAREL `adminPermissions`.) */
export function mayUseManage(permissions: ReadonlySet<string>, method: string, managePath: string): boolean {
  const areas = areasOf(permissions);
  const need = areaFor(method, managePath);
  if (need === 'any') return areas.length > 0;
  if (need === null) return areas.length === PERMISSION_AREAS.length;
  return need.some(area => areas.includes(area));
}
