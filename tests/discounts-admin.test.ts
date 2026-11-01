import {describe, expect, it} from 'vitest';

import {
  duplicateForm,
  fieldOf,
  localSummary,
  presetForm,
  randomCode as clientRandomCode,
  sampleSaving,
  summarize,
  toInput,
  validate,
  type NameOf,
  type PromoForm,
} from '../src/portal/screens/discounts/helpers';
import type {AdminDiscount} from '../src/lib/types/admin/promotions';
import {CODE_ALPHABET, makeCodes, randomCode} from '../src/server/routes/admin/discount-codes';
import {customerNameOf, zeroFilledDays} from '../src/server/routes/admin/discount-report';
import {
  DEFAULTS,
  defaultLabel,
  defaultNote,
  discountStatus,
  discountSummary,
  noNames,
  ruleText,
  type State,
  type TargetNames,
  toColumns,
} from '../src/server/routes/admin/discount-shared';
import {inputSchema, normalize, overlay} from '../src/server/routes/admin/discounts';
import {HttpError} from '../src/server/lib/errors';

const NOW = new Date('2026-11-01T12:00:00Z');
const state = (patch: Partial<State>): State => ({...DEFAULTS, ...patch});
const names = (products: Record<string, string> = {}, categories: Record<number, string> = {}): TargetNames => {
  const n = noNames();
  for (const [id, name] of Object.entries(products)) n.products.set(id, name);
  for (const [id, name] of Object.entries(categories)) n.categories.set(String(id), name);
  return n;
};
const stats = {used: 0, codesTotal: 0, codesUsed: 0};

function fieldsOf(fn: () => unknown): Record<string, string> {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(HttpError);
    return (e as HttpError).fields ?? {};
  }
  throw new Error('expected a 422');
}

describe('discountStatus', () => {
  const base = state({active: true, method: 'code', codeType: 'shared', code: 'X'});
  it('follows VAREL precedence: inactive → scheduled → expired → used_up → active', () => {
    expect(discountStatus({...base, active: false, startsAt: new Date('2027-01-01')}, stats, NOW)).toBe('inactive');
    expect(discountStatus({...base, startsAt: new Date('2027-01-01'), endsAt: new Date('2026-01-01')}, stats, NOW)).toBe('scheduled');
    expect(discountStatus({...base, endsAt: new Date('2026-10-01'), usageLimit: 1}, {...stats, used: 5}, NOW)).toBe('expired');
    expect(discountStatus({...base, usageLimit: 3}, {...stats, used: 3}, NOW)).toBe('used_up');
    expect(discountStatus({...base, usageLimit: 3}, {...stats, used: 2}, NOW)).toBe('active');
  });
  it('a unique-code discount with every code used is used up', () => {
    const u = {...base, codeType: 'unique' as const, code: null};
    expect(discountStatus(u, {used: 0, codesTotal: 20, codesUsed: 20}, NOW)).toBe('used_up');
    expect(discountStatus(u, {used: 0, codesTotal: 20, codesUsed: 19}, NOW)).toBe('active');
    expect(discountStatus(u, {used: 0, codesTotal: 0, codesUsed: 0}, NOW)).toBe('active');
  });
});

describe('ruleText / discountSummary (server)', () => {
  it('reads like VAREL for the seed shapes', () => {
    expect(
      discountSummary(
        state({kind: 'percent', value: 15, maxAmount: 40, codeType: 'unique', perCustomerLimit: 1}),
        noNames(),
        {codesTotal: 20},
        NOW,
        'USD'
      )
    ).toBe('15% off up to $40 · 20 unique codes · once per customer');
    expect(
      discountSummary(
        state({kind: 'fixed', value: 25, minimum: 200, code: 'FIRST25', eligibility: 'first_order', perCustomerLimit: 1}),
        noNames(),
        {codesTotal: 0},
        NOW,
        'USD'
      )
    ).toBe('$25 off · minimum spend $200 · code FIRST25 · first order only · once per customer');
    expect(discountSummary(state({kind: 'shipping', code: 'FREESHIP'}), noNames(), {codesTotal: 0}, NOW, 'USD')).toBe('Free shipping · code FREESHIP');
    expect(
      discountSummary(
        state({method: 'automatic', kind: 'percent', value: 20, scope: 'categories', categoryIds: ['3'], endsAt: new Date('2026-12-31T23:59:00Z')}),
        names({}, {3: 'Knitwear'}),
        {codesTotal: 0},
        NOW,
        'USD'
      )
    ).toBe('20% off Knitwear · automatic · not combinable · ends 31 Dec 2026');
  });

  it('names targets "A", "A and B", "A, B and 2 more"', () => {
    const n = names({a: 'A', b: 'B', c: 'C', d: 'D'});
    const r = (ids: string[]) => ruleText(state({kind: 'shipping', scope: 'products', productIds: ids}), n, true, 'USD');
    expect(r(['a'])).toBe('Free shipping on A');
    expect(r(['a', 'b'])).toBe('Free shipping on A and B');
    expect(r(['a', 'b', 'c', 'd'])).toBe('Free shipping on A, B and 2 more');
  });

  it('bxgy reads "Buy 2 X, get 1 free" or "at 50% off"', () => {
    const n = names({}, {7: 'T-Shirts'});
    const s = state({kind: 'bxgy', buyQty: 2, getQty: 1, getPercent: 100, scope: 'categories', categoryIds: ['7']});
    expect(ruleText(s, n, true, 'USD')).toBe('Buy 2 T-Shirts, get 1 free');
    expect(ruleText({...s, getPercent: 50}, n, true, 'USD')).toBe('Buy 2 T-Shirts, get 1 at 50% off');
  });

  it('defaultLabel stays within 60 characters; defaultNote variants', () => {
    const long = names({a: 'A very long product name that goes on and on', b: 'Another long product name'});
    const label = defaultLabel(state({kind: 'percent', value: 10, scope: 'products', productIds: ['a', 'b']}), long, 'USD');
    expect(label.length).toBeLessThanOrEqual(60);
    expect(label).toBe('10% off');
    expect(defaultNote(state({minimum: 100}), 'USD')).toBe('Minimum spend $100');
    expect(defaultNote(state({minimumQty: 3}), 'USD')).toBe('Minimum 3 items');
    expect(defaultNote(state({method: 'automatic'}), 'USD')).toBe('Applied automatically');
    expect(defaultNote(state({}), 'USD')).toBe('Any order');
  });
});

describe('normalize (server rules)', () => {
  const parse = (body: unknown) => inputSchema.parse(body);
  const norm = (body: Record<string, unknown>) => {
    const input = parse(body);
    return normalize(overlay(DEFAULTS, input), input);
  };

  it('automatic drops the code; asking for unique codes is a field error', () => {
    expect(norm({method: 'automatic', kind: 'shipping', code: 'X1'}).code).toBeNull();
    expect(fieldsOf(() => norm({method: 'automatic', kind: 'shipping', codeType: 'unique'})).codeType).toMatch(/don’t use codes/);
  });

  it('a shared code is required; unique has none', () => {
    expect(fieldsOf(() => norm({kind: 'shipping'})).code).toBe('Enter a code');
    expect(norm({kind: 'shipping', codeType: 'unique', code: 'ABC'}).code).toBeNull();
  });

  it('per-kind values', () => {
    expect(fieldsOf(() => norm({kind: 'percent', code: 'AB', value: 0})).value).toMatch(/between 1 and 100/);
    expect(fieldsOf(() => norm({kind: 'percent', code: 'AB', value: 10, maxAmount: 0})).maxAmount).toMatch(/above zero/);
    expect(fieldsOf(() => norm({kind: 'fixed', code: 'AB', value: 0})).value).toMatch(/above zero/);
    const ship = norm({kind: 'shipping', code: 'AB', value: 30, maxAmount: 5});
    expect([ship.value, ship.maxAmount]).toEqual([0, null]);
    const f = fieldsOf(() => norm({kind: 'bxgy', code: 'AB'}));
    expect(Object.keys(f).sort()).toEqual(expect.arrayContaining(['buyQty', 'getQty']));
  });

  it('scope lists: the chosen one must be non-empty, the others are cleared', () => {
    expect(fieldsOf(() => norm({kind: 'shipping', code: 'AB', scope: 'products'})).productIds).toBe('Choose at least one product');
    const s = norm({kind: 'shipping', code: 'AB', scope: 'categories', categoryIds: ['1'], productIds: ['p']});
    expect(s.productIds).toEqual([]);
    expect(s.categoryIds).toEqual(['1']);
  });

  it('customers eligibility needs customers; end after start', () => {
    expect(fieldsOf(() => norm({kind: 'shipping', code: 'AB', eligibility: 'customers'})).customerIds).toBe('Choose at least one customer');
    expect(norm({kind: 'shipping', code: 'AB', customerIds: ['3']}).customerIds).toEqual([]);
    expect(
      fieldsOf(() => norm({kind: 'shipping', code: 'AB', startsAt: '2026-12-01T00:00:00Z', endsAt: '2026-11-01T00:00:00Z'})).endsAt
    ).toBe('End after the start date');
  });

  it('upper-cases codes and checks their shape', () => {
    expect(parse({code: ' summer-10 '}).code).toBe('SUMMER-10');
    expect(inputSchema.safeParse({code: 'a b'}).success).toBe(false);
    expect(inputSchema.safeParse({note: 'x'.repeat(201)}).success).toBe(false);
  });
});

describe('toColumns', () => {
  it('maps the wire to the engine columns', () => {
    const pc = toColumns(state({kind: "percent", value: 15, maxAmount: 40}));
    expect(String(pc.percentOff)).toBe("15");
    expect(pc).toMatchObject({amountCents: null, maxAmountCents: 4000});
    expect(toColumns(state({kind: 'fixed', value: 25.5, minimum: 200}))).toMatchObject({percentOff: null, amountCents: 2550, minimumCents: 20000});
    expect(toColumns(state({kind: 'shipping'}))).toMatchObject({percentOff: null, amountCents: null});
    expect(toColumns(state({scope: 'categories', categoryIds: ['3', '9'], customerIds: ['12']}))).toMatchObject({categoryIds: [3, 9], customerIds: [12]});
  });
});

describe('code generator', () => {
  it('uses the look-alike-free alphabet, the prefix and the length', () => {
    for (let i = 0; i < 50; i++) {
      const c = randomCode('VIP-', 10);
      expect(c).toMatch(/^VIP-[A-HJ-NP-Z2-9]{10}$/);
    }
    expect(CODE_ALPHABET).not.toMatch(/[01IO]/);
    expect(clientRandomCode(8)).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
  });

  it('retries clashes and stops with codes_exhausted when the space is too small', async () => {
    const written: string[] = [];
    const made = await makeCodes(
      {count: 30, prefix: '', length: 8},
      (() => {
        let first = true;
        return async (c: string[]) => {
          const taken = first ? new Set(c.slice(0, 5)) : new Set<string>();
          first = false;
          return taken;
        };
      })(),
      async codes => (written.push(...codes), codes.length)
    );
    expect(made).toBe(30);
    expect(new Set(written).size).toBe(30);

    await expect(makeCodes({count: 10, prefix: 'X', length: 6}, async c => new Set(c), async c => c.length)).rejects.toMatchObject({
      status: 409,
      fields: {length: 'Use a longer code'},
    });
  });
});

describe('report helpers', () => {
  it('zero-fills 30 UTC days oldest first', () => {
    const days = zeroFilledDays(new Date('2026-10-03T00:00:00Z'), [{day: '2026-10-31', uses: 2, amount: 1000n, revenue: 9000n}] as never);
    expect(days).toHaveLength(30);
    expect(days[0]!.date).toBe('2026-10-03');
    expect(days.at(-1)!.date).toBe('2026-11-01');
    expect(days.find(d => d.date === '2026-10-31')).toMatchObject({uses: 2});
  });

  it('customerNameOf: profile → account name → address name → email', () => {
    expect(customerNameOf({email: 'a@x.test', address: null, user: {name: 'Acc', customerProfile: {firstName: 'Ann', lastName: 'Lee'}}})).toBe('Ann Lee');
    expect(customerNameOf({email: 'a@x.test', address: null, user: {name: 'Acc', customerProfile: null}})).toBe('Acc');
    expect(customerNameOf({email: 'a@x.test', address: {name: 'Addr'}, user: null})).toBe('Addr');
    expect(customerNameOf({email: 'a@x.test', address: null, user: null})).toBe('a@x.test');
  });
});

describe('client helpers', () => {
  const nameOf: NameOf = (kind, id) => ({category: {'3': 'Knitwear'}} as Record<string, Record<string, string>>)[kind]?.[id];
  const form = (patch: Partial<PromoForm>): PromoForm => ({...presetForm('order'), code: 'SAVE10', label: '10% off', ...patch});

  it('validate mirrors the server limits', () => {
    expect(validate(form({}))).toEqual({});
    expect(validate(form({value: '0'})).value).toBeDefined();
    expect(validate(form({kind: 'fixed', value: '100001'})).value).toBe('Use 100,000 or less.');
    expect(validate(form({maxAmount: '1000001'})).maxAmount).toBe('Use 1,000,000 or less.');
    expect(validate(form({usageLimit: '10000001'})).usageLimit).toBe('Use 10,000,000 or less.');
    expect(validate(form({note: 'x'.repeat(201)})).note).toBe('Keep the note under 200 characters.');
    expect(validate(form({code: 'a'})).code).toBeDefined();
    expect(validate(form({method: 'automatic', name: ''})).name).toMatch(/need a name/);
    expect(validate(form({startsAt: '2026-12-01T00:00:00Z', endsAt: '2026-11-01T00:00:00Z'})).endsAt).toBeDefined();
  });

  it('summarize matches the server summary for the same rule', () => {
    const f = form({method: 'automatic', name: 'Autumn', code: '', value: '20', scope: 'categories', categoryIds: ['3']});
    const server = discountSummary(
      state({method: 'automatic', kind: 'percent', value: 20, scope: 'categories', categoryIds: ['3']}),
      names({}, {3: 'Knitwear'}),
      {codesTotal: 0},
      NOW,
      'USD'
    );
    expect(summarize(f, nameOf, undefined, NOW.getTime())).toBe(server);
  });

  it('presets, duplicate, toInput, fieldOf, sampleSaving', () => {
    expect(presetForm('bxgy')).toMatchObject({kind: 'bxgy', buyQty: '2', getQty: '1', getPercent: '100', scope: 'categories'});
    expect(presetForm('shipping').kind).toBe('shipping');
    const d = {...toInput(form({})), id: '1', name: 'Spring', code: 'SPRING', status: 'active', summary: '', used: 0, totalDiscounted: 0, revenue: 0, codesTotal: 0, codesUsed: 0, createdAt: '', updatedAt: ''} as AdminDiscount;
    expect(duplicateForm(d)).toMatchObject({name: 'Spring copy', code: 'SPRING-COPY', active: false});
    expect(toInput(form({kind: 'shipping', value: '10'})).value).toBe(0);
    expect(toInput(form({method: 'automatic'})).code).toBeNull();
    expect(fieldOf('productIds.2')).toBe('productIds');
    expect(fieldOf('bxgy.buyQty')).toBe('buyQty');
    expect(sampleSaving(form({value: '10'})).amount).toBeGreaterThan(0);
    expect(sampleSaving(form({kind: 'shipping'})).amount).toBeNull();
  });

  it('localSummary keeps the starts/ends format', () => {
    const s = localSummary({summary: '10% off · ends 31 Dec 2026', startsAt: null, endsAt: '2026-12-31T12:00:00Z'});
    expect(s).toMatch(/^10% off · ends \d{1,2} \w{3} 2026$/);
  });
});
