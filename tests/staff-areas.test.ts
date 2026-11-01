import {describe, expect, it} from 'vitest';

import type {StaffRoleOption} from '../src/lib/types/admin/staff';
import {validateActivitySearch} from '../src/portal/queries/activity';
import {accessSummary, areasOfRoles, checklistRoles, emailProblem} from '../src/portal/screens/staff/areas';
import {areasOf, PERMISSION_AREAS, PERMISSIONS} from '../src/server/permissions';

const role = (slug: string, areas: StaffRoleOption['areas'], assignable = true): StaffRoleOption => ({
  slug,
  name: slug[0]!.toUpperCase() + slug.slice(1),
  description: null,
  areas,
  assignable,
  system: true,
});

describe('staff areas from role codenames', () => {
  it('the owner (*) and a full admin hold every area; staff hold all but settings and staff', () => {
    expect(areasOf(new Set(['*']))).toEqual([...PERMISSION_AREAS]);
    const staff = new Set([
      PERMISSIONS.SHOP_ORDER_MANAGE,
      PERMISSIONS.CUSTOMER_MANAGE,
      PERMISSIONS.PRODUCT_MANAGE,
      PERMISSIONS.CONTENT_MANAGE,
      PERMISSIONS.DISCOUNT_MANAGE,
      PERMISSIONS.ANALYTICS_READ,
    ]);
    expect(areasOf(staff)).toEqual(['orders', 'customers', 'products', 'content', 'discounts', 'analytics']);
    expect(areasOf(new Set(['site:user:*']))).toEqual(['staff']);
    expect(areasOf(new Set())).toEqual([]);
  });
});

describe('the role checklist', () => {
  const roles = [
    role('owner', [...PERMISSION_AREAS], false),
    role('admin', [...PERMISSION_AREAS]),
    role('staff', ['orders', 'customers', 'products', 'content', 'discounts', 'analytics']),
    role('member', []),
    role('writer', ['content']),
    role('newsletter', []),
  ];

  it('offers every role with store areas except owner and member', () => {
    expect(checklistRoles(roles).map(r => r.slug)).toEqual(['admin', 'staff', 'writer']);
  });

  it('sums the chosen roles into one line', () => {
    expect(accessSummary(areasOfRoles(['admin'], roles))).toBe('Full access: every area of the admin.');
    expect(accessSummary(areasOfRoles(['writer'], roles))).toBe('1 of 8 areas: Content.');
    expect(accessSummary(areasOfRoles(['staff', 'writer'], roles))).toBe(
      '6 of 8 areas: Orders, Customers, Products, Content, Discounts, Analytics.'
    );
    expect(accessSummary([])).toBe('Choose at least one role with store access.');
  });

  it('checks emails like the server', () => {
    expect(emailProblem('')).toBe('Enter your email address');
    expect(emailProblem('nope')).toBe('Enter a valid email address');
    expect(emailProblem(`${'a'.repeat(250)}@b.co`)).toBe('That email address is too long');
    expect(emailProblem(' ada@varel.studio ')).toBeNull();
  });
});

describe('activity search params', () => {
  it('keeps good filters and drops a bad date, an unknown tab, a bad actor and a stray page', () => {
    expect(validateActivitySearch({q: ' coat ', actor: '12', entity: 'product', from: '2026-10-01', to: 'nope', tab: 'other', page: '3'})).toEqual({
      q: 'coat',
      actor: '12',
      entity: 'product',
      from: '2026-10-01',
    });
    expect(validateActivitySearch({tab: 'security', actor: 'abc'})).toEqual({tab: 'security'});
  });
});
