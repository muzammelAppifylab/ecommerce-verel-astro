import {useNavigate} from '@tanstack/react-router';
import {useId, useState} from 'react';

import {dotJoin, pluralize} from '../../../lib/format';
import type {InventoryRow} from '../../../lib/types/admin/catalog';
import {useBulkInventory} from '../../queries/inventory';
import {BulkAction, BulkBar, Button, Field, Icon, Menu, type MenuItem, Modal, Notice, useToast} from '../../ui';
import {downloadCsv} from './parts';

/*
 * Row and bulk actions for inventory (port of VAREL `src/pages/admin/inventory/InventoryActions.tsx`).
 * Bulk writes go through POST /inventory/bulk (one transaction), so a set or an adjustment over many
 * variants either lands everywhere or nowhere.
 */

type Mode = 'set' | 'adjust' | 'zero';

export const variantName = (r: Pick<InventoryRow, 'color' | 'size' | 'options'>) =>
  dotJoin(r.color ?? '', r.size ?? '', ...Object.values(r.options ?? {})) || 'Default';

/* ---------- Single row ---------- */

export function InventoryRowMenu({row, onZero, disabled}: {row: InventoryRow; onZero: () => void; disabled?: boolean}) {
  const navigate = useNavigate();
  const toast = useToast();
  const items: MenuItem[] = [
    {label: 'Edit product', icon: 'pencil', onSelect: () => void navigate({to: '/products/$id', params: {id: row.productId}})},
    {
      label: 'Copy SKU',
      icon: 'copy',
      onSelect: () =>
        void navigator.clipboard.writeText(row.variantId).then(
          () => toast.success(`${row.variantId} copied`),
          () => toast.danger('The SKU could not be copied')
        ),
    },
  ];
  if (row.inventory > 0) items.push('separator', {label: 'Mark out of stock', icon: 'ban', danger: true, onSelect: onZero});
  return <Menu label={`Actions for ${row.variantId}`} items={items} disabled={disabled} />;
}

/* ---------- Bulk ---------- */

/** The count a row gets in a bulk mode, given the typed amount `n`. */
export function nextCount(mode: Mode, n: number, inventory: number): number {
  return mode === 'zero' ? 0 : mode === 'set' ? n : Math.max(0, inventory + n);
}

/** Whether the typed amount works for the mode: set ≥ 0, adjust ≠ 0, both whole numbers. */
export function amountValid(mode: Mode, amount: string): boolean {
  if (mode === 'zero') return true;
  const n = amount === '' || amount === '-' ? NaN : Number(amount);
  return Number.isInteger(n) && (mode === 'set' ? n >= 0 : n !== 0);
}

export function InventoryBulkBar({rows, onClear, onDone}: {rows: InventoryRow[]; onClear: () => void; onDone: (ids: string[]) => void}) {
  const bulk = useBulkInventory();
  const toast = useToast();
  const id = useId();
  const [mode, setMode] = useState<Mode | null>(null);
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);

  const n = amount === '' || amount === '-' ? NaN : Number(amount);
  const valid = mode !== null && amountValid(mode, amount);
  const next = (r: InventoryRow) => nextCount(mode ?? 'set', n, r.inventory);
  const changes = valid ? rows.filter(r => next(r) !== r.inventory) : [];
  const allZero = rows.every(r => r.inventory === 0);

  const open = (m: Mode) => {
    setAmount('');
    setError(null);
    setMode(m);
  };
  const close = () => {
    if (!bulk.isPending) setMode(null);
  };

  const run = () => {
    if (!valid) return;
    if (!changes.length) return setMode(null);
    setError(null);
    bulk.mutate(
      changes.map(r => ({variantId: r.variantId, inventory: next(r)})),
      {
        onSuccess: res => {
          toast.success(`Stock updated for ${pluralize(res.updated, 'variant')}`);
          onDone(changes.map(r => r.variantId));
          setMode(null);
        },
        onError: e => setError(e instanceof Error && e.message ? e.message : 'Stock could not be updated'),
      }
    );
  };

  const title =
    mode === 'set' ? 'Set stock' : mode === 'adjust' ? 'Adjust stock' : `Mark ${pluralize(rows.length, 'variant')} out of stock?`;
  const description =
    mode === 'set'
      ? 'Every selected variant gets the same count.'
      : mode === 'adjust'
        ? 'Add stock with a positive number, remove it with a negative one. Counts never go below zero.'
        : 'Customers can no longer add these variants to the bag.';
  const unchanged = rows.length - changes.length;

  return (
    <>
      <BulkBar count={rows.length} noun={['variant', 'variants']} onClear={onClear}>
        <BulkAction icon="pencil" onClick={() => open('set')}>
          Set stock
        </BulkAction>
        <BulkAction icon="chevrons-up-down" onClick={() => open('adjust')}>
          Adjust
        </BulkAction>
        <BulkAction
          icon="ban"
          disabled={allZero}
          hint={allZero ? 'All selected variants are already out of stock' : undefined}
          onClick={() => open('zero')}>
          Out of stock
        </BulkAction>
        <BulkAction
          icon="download"
          onClick={() => {
            downloadCsv(
              `varel-inventory-selected-${rows.length}.csv`,
              ['SKU', 'Product', 'Colour', 'Size', 'Inventory', 'State'],
              rows.map(r => [r.variantId, r.productName, r.color, r.size, r.inventory, r.state])
            );
            toast.success(`Exported ${pluralize(rows.length, 'variant')}`);
          }}>
          Export
        </BulkAction>
      </BulkBar>

      <Modal
        open={mode !== null}
        onClose={close}
        dismissible={!bulk.isPending}
        title={title}
        description={description}
        footer={
          <>
            <Button variant="secondary" onClick={close} disabled={bulk.isPending}>
              Cancel
            </Button>
            <Button
              variant={mode === 'zero' ? 'danger' : 'primary'}
              disabled={!valid}
              pending={bulk.isPending}
              pendingLabel="Updating…"
              onClick={run}>
              {changes.length ? `Update ${pluralize(changes.length, 'variant')}` : 'Nothing to change'}
            </Button>
          </>
        }>
        <div className="inv-bulk-body">
          {mode !== null && mode !== 'zero' && (
            <Field id={`${id}-amount`} label={mode === 'set' ? 'New stock count' : 'Change by'}>
              <input
                id={`${id}-amount`}
                className="inv-amount"
                autoFocus
                inputMode="numeric"
                autoComplete="off"
                value={amount}
                placeholder={mode === 'set' ? '0' : '+10 or −5'}
                onChange={e => setAmount(e.target.value.replace(mode === 'set' ? /[^\d]/g : /[^\d-]|(?!^)-/g, ''))}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    run();
                  }
                }}
              />
            </Field>
          )}
          <ul className="inv-preview">
            {rows.map(r => {
              const to = valid ? next(r) : null;
              const changed = to !== null && to !== r.inventory;
              return (
                <li key={r.variantId}>
                  <span className="inv-preview-name">
                    {r.productName} <span className="muted">· {variantName(r)}</span>
                  </span>
                  <span className="inv-preview-count">
                    <span className={changed ? 'inv-old' : undefined}>{r.inventory}</span>
                    {changed && (
                      <>
                        <Icon name="arrow-right" size={14} />
                        <span className={to === 0 ? 'inv-zero' : undefined}>{to}</span>
                      </>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          {valid && unchanged > 0 && (
            <p className="muted">
              {pluralize(unchanged, 'variant')} already {unchanged === 1 ? 'has' : 'have'} that count.
            </p>
          )}
          {error && <Notice tone="danger">{error}</Notice>}
        </div>
      </Modal>
    </>
  );
}
