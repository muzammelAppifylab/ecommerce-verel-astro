import {describe, expect, it} from 'vitest';

import {CUSTOMER_SORT_FIELDS, customerSearchWhere, deriveRole, roleWhere} from '../src/server/routes/admin/customers';
import {parseSort} from '../src/server/lib/http';
import {csvCell, csvText} from '../src/portal/screens/customers/lib';

describe('customers admin: role derivation (display only)', () => {
  it('maps template roles to VAREL roles', () => {
    expect(deriveRole([])).toBe('customer');
    expect(deriveRole(['member'])).toBe('customer');
    expect(deriveRole(['member', 'staff'])).toBe('staff');
    expect(deriveRole(['member', 'editor'])).toBe('staff');
    expect(deriveRole(['owner'])).toBe('admin');
    expect(deriveRole(['admin', 'staff'])).toBe('admin');
  });

  it('builds the role filter', () => {
    expect(roleWhere([])).toEqual({});
    expect(roleWhere(['customer', 'staff', 'admin'])).toEqual({});
    expect(roleWhere(['customer'])).toEqual({roles: {none: {role: {slug: {not: 'member'}}}}});
    const both = roleWhere(['customer', 'admin']) as {OR: unknown[]};
    expect(both.OR).toHaveLength(2);
    expect(both.OR[1]).toEqual({roles: {some: {role: {slug: {in: ['owner', 'admin']}}}}});
  });

  it('search: at most five words, ANDed', () => {
    expect(customerSearchWhere('')).toEqual({});
    const where = customerSearchWhere('  a b c d e f g ') as {AND: unknown[]};
    expect(where.AND).toHaveLength(5);
  });

  it('sort accepts name/email/createdAt only', () => {
    expect(parseSort('-createdAt', CUSTOMER_SORT_FIELDS, '-createdAt')).toEqual({field: 'createdAt', dir: 'desc'});
    expect(parseSort('email', CUSTOMER_SORT_FIELDS, '-createdAt')).toEqual({field: 'email', dir: 'asc'});
    expect(parseSort('spent', CUSTOMER_SORT_FIELDS, '-createdAt')).toBeNull();
  });
});

describe('portal CSV helper', () => {
  it('escapes formulas, quotes and uses CRLF', () => {
    expect(csvCell('=cmd')).toBe("'=cmd");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell(null)).toBe('');
    expect(csvText(['A', 'B'], [['x', 1]])).toBe('A,B\r\nx,1\r\n');
  });
});
