import {describe, expect, it} from 'vitest';

import {type MoveCandidate, planMove} from '../src/server/routes/wishlist';

const v = (id: string, inventory: number | null, color: string | null = null, size: string | null = null) => ({
  id,
  color,
  size,
  inventory,
});

const item = (id: number, productId: string, variants: MoveCandidate['product']['variants'], allowBackorder = false): MoveCandidate => ({
  id,
  productId,
  product: {allowBackorder, variants},
});

describe('planMove (wishlist → bag)', () => {
  it('moves an in-stock piece as a new line of one unit', () => {
    const plan = planMove([item(1, 'a', [v('A-1', 3)])], []);
    expect(plan).toEqual({creates: [{productId: 'a', variantId: 'A-1', qty: 1}], updates: [], moved: [1]});
  });

  it('leaves a sold-out piece on the wishlist', () => {
    expect(planMove([item(1, 'a', [v('A-1', 0)])], [])).toEqual({creates: [], updates: [], moved: []});
  });

  it('moves a digital piece (no inventory)', () => {
    expect(planMove([item(1, 'pdf', [v('P-1', null)])], []).moved).toEqual([1]);
  });

  it('picks the first variant in stock when the first is sold out', () => {
    const plan = planMove([item(1, 'a', [v('A-S', 0, 'Stone', 'S'), v('A-M', 2, 'Stone', 'M')])], []);
    expect(plan.creates).toEqual([{productId: 'a', variantId: 'A-M', qty: 1}]);
  });

  it('merges into an existing line of the variant', () => {
    const plan = planMove([item(1, 'a', [v('A-1', 5)])], [{id: 9, variantId: 'A-1', qty: 2}]);
    expect(plan).toEqual({creates: [], updates: [{lineId: 9, qty: 3}], moved: [1]});
  });

  it('keeps the piece when the bag already holds all the stock', () => {
    expect(planMove([item(1, 'a', [v('A-1', 2)])], [{id: 9, variantId: 'A-1', qty: 2}]).moved).toEqual([]);
  });

  it('keeps the piece when the line is at 99 units', () => {
    expect(planMove([item(1, 'pdf', [v('P-1', null)])], [{id: 9, variantId: 'P-1', qty: 99}]).moved).toEqual([]);
  });

  it('backorder: goes past the stock in the bag, but a variant at zero stays (VAREL parity)', () => {
    expect(planMove([item(1, 'a', [v('A-1', 1)], true)], [{id: 9, variantId: 'A-1', qty: 1}]).updates).toEqual([
      {lineId: 9, qty: 2},
    ]);
    expect(planMove([item(1, 'a', [v('A-1', 0)], true)], []).moved).toEqual([]);
  });

  it('respects the bag line limit for new lines but still merges', () => {
    const lines = [{id: 9, variantId: 'B-1', qty: 1}];
    const plan = planMove([item(1, 'a', [v('A-1', 5)]), item(2, 'b', [v('B-1', 5)])], lines, 1);
    expect(plan.creates).toEqual([]);
    expect(plan.updates).toEqual([{lineId: 9, qty: 2}]);
    expect(plan.moved).toEqual([2]);
  });

  it('keeps the wishlist order and handles several pieces', () => {
    const plan = planMove([item(3, 'c', [v('C-1', 1)]), item(1, 'a', [v('A-1', 0)]), item(2, 'b', [v('B-1', 4)])], []);
    expect(plan.moved).toEqual([3, 2]);
    expect(plan.creates.map(c => c.variantId)).toEqual(['C-1', 'B-1']);
  });

  it('a piece without variants stays; an empty wishlist plans nothing', () => {
    expect(planMove([item(1, 'a', [])], []).moved).toEqual([]);
    expect(planMove([], [])).toEqual({creates: [], updates: [], moved: []});
  });
});
