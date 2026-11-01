import {describe, expect, it} from 'vitest';

import {
  abilitiesOf,
  allows,
  catalogueProblems,
  CORE,
  definePermissions,
  ownCodename,
  scopeOf,
} from '../src/platform/auth/codenames';
import {
  type Abilities,
  abilitiesFor,
  areaFor,
  areasOf,
  CATALOGUE,
  mayUseManage,
  NO_ABILITIES,
  PERMISSIONS,
} from '../src/server/permissions';

describe('the permission catalogue', () => {
  it('is well formed', () => {
    expect(catalogueProblems(CATALOGUE)).toEqual([]);
  });

  it('keeps the shipped codenames and ability keys', () => {
    expect(CORE.USER_READ).toBe('site:user:read');
    expect(CORE.USER_UPDATE).toBe('site:user:update');
    expect(CORE.ROLE_READ).toBe('site:role:read');
    expect(CORE.ROLE_UPDATE).toBe('site:role:update');
    expect(CORE.AUDIT_READ).toBe('site:audit:read');
    // PLAN.md §7: F1's role migration grants these exact codenames.
    expect(PERMISSIONS.SHOP_ORDER_MANAGE).toBe('site:shop_order:manage');
    expect(PERMISSIONS.CUSTOMER_MANAGE).toBe('site:customer:manage');
    expect(PERMISSIONS.PRODUCT_MANAGE).toBe('site:product:manage');
    expect(PERMISSIONS.CONTENT_MANAGE).toBe('site:content:manage');
    expect(PERMISSIONS.DISCOUNT_MANAGE).toBe('site:discount:manage');
    expect(PERMISSIONS.ANALYTICS_READ).toBe('site:analytics:read');
    expect(PERMISSIONS.STORE_SETTINGS_MANAGE).toBe('site:store_settings:manage');
    expect(CATALOGUE.STORE_SETTINGS_MANAGE.roles).toEqual(['admin']);
    expect(CATALOGUE.SHOP_ORDER_MANAGE.roles).toEqual(['admin', 'staff']);
    expect(Object.keys(NO_ABILITIES).sort()).toEqual(
      [
        'editRoles',
        'manageRoles',
        'manageUsers',
        'readAudit',
        'updateUsers',
        'manageOrders',
        'manageCustomers',
        'manageProducts',
        'manageContent',
        'manageDiscounts',
        'viewAnalytics',
        'manageStoreSettings',
      ].sort()
    );
    expect(Object.values(NO_ABILITIES).every(v => v === false)).toBe(true);
  });

  it('derives the abilities from granted codenames, wildcards included', () => {
    const owner = abilitiesFor(new Set(['*']));
    expect(Object.values(owner).every(Boolean)).toBe(true);
    const admin = abilitiesFor(new Set(['site:user:*', 'site:role:read', 'site:audit:read', 'site:product:manage']));
    expect(admin).toEqual({
      manageUsers: true,
      updateUsers: true,
      manageRoles: true,
      editRoles: false,
      readAudit: true,
      manageOrders: false,
      manageCustomers: false,
      manageProducts: true,
      manageContent: false,
      manageDiscounts: false,
      viewAnalytics: false,
      manageStoreSettings: false,
    } satisfies Abilities);
    // The type is exact: a key nobody declared does not exist.
    // @ts-expect-error not in the catalogue
    void NO_ABILITIES.manageEverything;
  });

  it('refuses a malformed entry at load', () => {
    expect(() => definePermissions({BAD: {codename: 'Site:Bad', title: 'Bad', group: 'X'}})).toThrow(/bad codename/);
    expect(() =>
      definePermissions({
        A: {codename: 'site:a:read', title: 'A', group: 'X', ability: 'seeA'},
        B: {codename: 'site:a:read', title: 'B', group: 'X', ability: 'seeA'},
      })
    ).toThrow(/declared twice/);
    expect(() => definePermissions({T: {codename: 'site:t:read', title: '', group: 'X'}})).toThrow(/title/);
  });

  it('a new entry is one edit: codename, ability and type follow', () => {
    const site = definePermissions({
      CRM_READ: {codename: 'site:crm:read', title: 'See contacts', group: 'CRM', ability: 'seeContacts', roles: ['admin']},
    });
    const flags = abilitiesOf(site, new Set(['site:crm:*']));
    expect(flags).toEqual({seeContacts: true});
    const typed: {seeContacts: boolean} = flags;
    expect(typed.seeContacts).toBe(true);
  });
});

describe('store admin areas (VAREL adminPermissions)', () => {
  const staff = new Set(['site:shop_order:manage', 'site:product:manage']);

  it('maps codenames to areas, wildcards included', () => {
    expect(areasOf(staff)).toEqual(['orders', 'products']);
    expect(areasOf(new Set(['*']))).toHaveLength(8);
    expect(areasOf(new Set(['site:user:*']))).toEqual(['staff']);
    expect(areasOf(new Set())).toEqual([]);
  });

  it('decides per path segment and method', () => {
    expect(areaFor('GET', '/orders/VRL-1')).toEqual(['orders']);
    expect(areaFor('GET', '/settings')).toBe('any');
    expect(areaFor('PATCH', '/settings')).toEqual(['settings']);
    expect(areaFor('GET', '/nope')).toBeNull();
  });

  it('lets staff in only to their areas', () => {
    expect(mayUseManage(staff, 'GET', '/orders')).toBe(true);
    expect(mayUseManage(staff, 'POST', '/products')).toBe(true);
    expect(mayUseManage(staff, 'GET', '/discounts')).toBe(false);
    expect(mayUseManage(staff, 'GET', '/settings')).toBe(true); // reads open to any staff
    expect(mayUseManage(staff, 'PATCH', '/settings')).toBe(false);
    expect(mayUseManage(staff, 'GET', '/dashboard')).toBe(true);
    expect(mayUseManage(new Set(['site:discount:manage']), 'GET', '/products')).toBe(true);
    expect(mayUseManage(new Set(), 'GET', '/dashboard')).toBe(false); // a customer
    expect(mayUseManage(staff, 'GET', '/unknown')).toBe(false); // unmapped: every area
    expect(mayUseManage(new Set(['*']), 'GET', '/unknown')).toBe(true);
  });
});

describe('own-records permissions', () => {
  const ALL = new Set(['site:note:update']);
  const OWN = new Set(['site:note:update_own']);
  const NONE = new Set<string>(['site:note:read']);

  it('names the own variant', () => {
    expect(ownCodename('site:note:update')).toBe('site:note:update_own');
    expect(ownCodename('site:note:update_own')).toBe('site:note:update_own');
  });

  it('scopes all / own / none', () => {
    expect(scopeOf(ALL, 'site:note:update')).toBe('all');
    expect(scopeOf(OWN, 'site:note:update')).toBe('own');
    expect(scopeOf(NONE, 'site:note:update')).toBe('none');
    expect(scopeOf(new Set(['site:note:*']), 'site:note:update')).toBe('all');
    expect(scopeOf(new Set(['*']), 'site:note:update')).toBe('all');
  });

  it('allows the own variant only on the viewer’s own records', () => {
    expect(allows(ALL, 'site:note:update', 7, 99)).toBe(true);
    expect(allows(OWN, 'site:note:update', 7, 7)).toBe(true);
    expect(allows(OWN, 'site:note:update', 7, 99)).toBe(false);
    expect(allows(OWN, 'site:note:update', 7, null)).toBe(false); // nobody's record
    expect(allows(OWN, 'site:note:update', null, null)).toBe(false); // a guest
    expect(allows(OWN, 'site:note:update', 7, undefined)).toBe(false);
    expect(allows(NONE, 'site:note:update', 7, 7)).toBe(false);
  });
});
