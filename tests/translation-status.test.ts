/* Translation coverage (WP-25; VAREL worker/lib/i18n/status.ts): cell statuses, the list order, its keyset cursor
   and the list filters. */
import assert from 'node:assert/strict';
import {describe, it} from 'vitest';

import {
  afterCursor,
  cellCursor,
  compareCells,
  decodeCellCursor,
  filterCells,
  localesFor,
  needsAuto,
  type Cell,
} from '../src/server/lib/i18n/status';
import type {I18nConfig} from '../src/server/lib/i18n/translate';

const cfg: I18nConfig = {defaultLocale: 'en', locales: ['en', 'da', 'de', 'nl'], provider: 'mock', autoTranslate: true};

const cell = (over: Partial<Cell>): Cell => ({
  entity: 'product',
  entityId: 'p1',
  label: 'Coat',
  field: 'name',
  locale: 'da',
  status: 'auto',
  origin: 'auto',
  sourceValue: 'Coat',
  value: '[da] Coat',
  updatedAt: null,
  ...over,
});

describe('cells', () => {
  it('needsAuto: missing and stale auto, never manual', () => {
    assert.equal(needsAuto(cell({status: 'missing', origin: null})), true);
    assert.equal(needsAuto(cell({status: 'stale', origin: 'auto'})), true);
    assert.equal(needsAuto(cell({status: 'stale', origin: 'manual'})), false);
    assert.equal(needsAuto(cell({status: 'auto'})), false);
    assert.equal(needsAuto(cell({status: 'manual', origin: 'manual'})), false);
  });
  it('localesFor: targets only; interface text only for languages without shipped catalogs', () => {
    assert.deepEqual(localesFor(cfg, 'product'), ['da', 'de', 'nl']);
    assert.deepEqual(localesFor(cfg, 'ui'), ['nl']);
  });
});

describe('list order and keyset cursor', () => {
  const cells: Cell[] = [];
  for (const [entity, id, label] of [
    ['post', '2', 'Autumn notes'],
    ['product', 'b', 'Belt'],
    ['product', 'a', 'Coat'],
    ['product', 'c', 'Coat'],
  ] as const)
    for (const field of ['name', 'short'])
      for (const locale of ['de', 'da', 'nl']) cells.push(cell({entity, entityId: id, label, field: entity === 'post' ? (field === 'name' ? 'title' : 'excerpt') : field, locale}));
  const sorted = [...cells].sort(compareCells(cfg));

  it('sorts by entity, label, id, field, then language', () => {
    assert.equal(sorted[0]!.entity, 'product');
    assert.deepEqual(
      sorted.slice(0, 6).map(c => `${c.label}/${c.entityId}/${c.field}/${c.locale}`),
      ['Belt/b/name/da', 'Belt/b/name/de', 'Belt/b/name/nl', 'Belt/b/short/da', 'Belt/b/short/de', 'Belt/b/short/nl']
    );
    assert.equal(sorted.at(-1)!.entity, 'post');
  });

  it('pages without duplicates or gaps', () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 20; i++) {
      const page = afterCursor(sorted, decodeCellCursor(cursor), cfg).slice(0, 5);
      if (!page.length) break;
      seen.push(...page.map(c => `${c.entity}:${c.entityId}:${c.field}:${c.locale}`));
      cursor = cellCursor(page.at(-1)!, cfg);
    }
    assert.equal(seen.length, cells.length);
    assert.equal(new Set(seen).size, cells.length);
  });

  it('starts from the top on a bad cursor', () => {
    assert.equal(decodeCellCursor('garbage'), null);
    assert.equal(afterCursor(sorted, decodeCellCursor('garbage'), cfg).length, sorted.length);
  });
});

describe('filters', () => {
  const cells = [
    cell({entityId: 'a', status: 'missing', origin: null, value: null}),
    cell({entityId: 'b', status: 'stale', origin: 'auto'}),
    cell({entityId: 'c', status: 'stale', origin: 'manual', value: 'Frakke'}),
    cell({entityId: 'd', status: 'manual', origin: 'manual', label: 'Scarf', sourceValue: 'Scarf', value: 'Tørklæde'}),
  ];
  const ids = (list: Cell[]) => list.map(c => c.entityId).join('');

  it('missing and stale by status, auto and manual by origin', () => {
    assert.equal(ids(filterCells(cells, {status: 'missing'})), 'a');
    assert.equal(ids(filterCells(cells, {status: 'stale'})), 'bc');
    assert.equal(ids(filterCells(cells, {status: 'auto'})), 'b');
    assert.equal(ids(filterCells(cells, {status: 'manual'})), 'cd');
    assert.equal(ids(filterCells(cells, {status: ''})), 'abcd');
  });
  it('q matches the label, the source, the translation or the exact id', () => {
    assert.equal(ids(filterCells(cells, {q: 'scar'})), 'd');
    assert.equal(ids(filterCells(cells, {q: 'TØRKL'})), 'd');
    assert.equal(ids(filterCells(cells, {q: 'frakke'})), 'c');
    assert.equal(ids(filterCells(cells, {q: 'b'})), 'b');
  });
});
