/* Row and bulk actions for the products list (VAREL `ProductActions.tsx`). Status moves: draft ⇄ published ⇄ archived.
   Delete is permanent unless the product appears in orders, in which case the server archives it.
   `RowMenu` → kit `Menu`; `ConfirmDialog` → `useConfirm` (the action runs inside the dialog); `notify` → `useToast`. */
import {useNavigate} from '@tanstack/react-router';
import {useState} from 'react';

import {pluralize} from '../../../lib/format';
import type {AdminProductRow, ProductBulkAction, ProductBulkResult, ProductStatus} from '../../../lib/types/admin/catalog';
import {useBulkProducts, useDuplicateProduct} from '../../queries/products';
import {BulkAction, BulkBar, type IconName, Menu, type MenuItem, StatusBadge, useConfirm, useToast} from '../../ui';
import {downloadCsv} from './list-ui';

type Op = ProductStatus | 'delete';

export const STATUS_TONES = {published: 'success', draft: 'warning', archived: 'neutral'} as const;
export const STATUS_LABEL: Record<ProductStatus, string> = {published: 'Published', draft: 'Draft', archived: 'Archived'};

export function ProductStatusBadge({status}: {status: ProductStatus}) {
  return <StatusBadge tone={STATUS_TONES[status]}>{STATUS_LABEL[status]}</StatusBadge>;
}

// VAREL icons Send / FilePen / Archive: the kit has none of them yet (Request F5), so the closest kit icons.
const OP: Record<Op, {verb: string; done: string; pending: string; icon: IconName; title: (n: number) => string; note: string}> = {
  published: {
    verb: 'Publish',
    done: 'published',
    pending: 'Publishing…',
    icon: 'arrow-right',
    title: n => `Publish ${pluralize(n, 'product')}?`,
    note: 'They appear in the shop, search and product pages straight away.',
  },
  draft: {
    verb: 'Move to draft',
    done: 'moved to draft',
    pending: 'Moving…',
    icon: 'pencil',
    title: n => `Move ${pluralize(n, 'product')} to draft?`,
    note: 'They are hidden from the shop until published again.',
  },
  archived: {
    verb: 'Archive',
    done: 'archived',
    pending: 'Archiving…',
    icon: 'inbox',
    title: n => `Archive ${pluralize(n, 'product')}?`,
    note: 'They disappear from the shop, search and wishlists. Orders keep their history.',
  },
  delete: {
    verb: 'Delete',
    done: 'deleted',
    pending: 'Deleting…',
    icon: 'trash',
    title: n => `Delete ${pluralize(n, 'product')}?`,
    note: 'Products, their images and variants are removed permanently. Products that appear in orders are archived instead.',
  },
};

const STATUSES = ['published', 'draft', 'archived'] as const;

const eligible = (rows: AdminProductRow[], op: Op) => (op === 'delete' ? rows : rows.filter(p => p.status !== op));
const actionFor = (op: Op): ProductBulkAction => (op === 'delete' ? 'delete' : {status: op});
const messageOf = (e: unknown) => (e instanceof Error ? e.message : 'Try again.');

/** The confirm body: exactly which products the action changes. */
function ConfirmList({op, rows, skipped}: {op: Op; rows: AdminProductRow[]; skipped: number}) {
  return (
    <div className="confirm-products">
      <p>{OP[op].note}</p>
      <ul className="confirm-list">
        {rows.map(p => (
          <li key={p.id}>
            <span>
              {p.name} <span className="muted">· {p.sku}</span>
            </span>
            <ProductStatusBadge status={p.status} />
          </li>
        ))}
      </ul>
      {skipped > 0 && (
        <p className="muted">
          {pluralize(skipped, 'selected product')} {skipped === 1 ? 'is' : 'are'} already {OP[op].done}.
        </p>
      )}
    </div>
  );
}

/** Asks, runs the bulk mutation inside the dialog, and reports by toasts (per-item failures never keep it open). */
function useRunOp() {
  const confirm = useConfirm();
  const toast = useToast();
  const bulk = useBulkProducts();

  const report = (op: Op, rows: AdminProductRow[], r: ProductBulkResult) => {
    const name = (id: string) => rows.find(p => p.id === id)?.name ?? id;
    if (r.done.length)
      toast.success(r.done.length === 1 ? `${name(r.done[0] as string)} ${OP[op].done}` : `${pluralize(r.done.length, 'product')} ${OP[op].done}`);
    if (r.archived.length)
      toast.info(
        `${r.archived.map(name).join(', ')} ${r.archived.length === 1 ? 'has' : 'have'} orders, so ${r.archived.length === 1 ? 'it was' : 'they were'} archived instead`
      );
    if (r.failed.length) toast.danger(`${r.failed.map(f => name(f.id)).join(', ')} could not be updated: ${messageOf(r.failed[0]?.error)}`);
  };

  const run = async (op: Op, target: AdminProductRow[], skipped: number, onDone?: (ids: string[]) => void) => {
    const box: {result?: ProductBulkResult} = {};
    await confirm({
      title: OP[op].title(target.length),
      body: <ConfirmList op={op} rows={target} skipped={skipped} />,
      confirmLabel: OP[op].verb,
      pendingLabel: OP[op].pending,
      tone: op === 'delete' ? 'danger' : 'primary',
      action: async () => {
        box.result = await bulk.mutateAsync({ids: target.map(p => p.id), action: actionFor(op)});
      },
    });
    const r = box.result;
    if (r) {
      report(op, target, r);
      onDone?.([...r.done, ...r.archived]);
    }
  };
  return {run, pending: bulk.isPending, pendingIds: bulk.isPending ? (bulk.variables?.ids ?? []) : []};
}

/* ---------- Single row ---------- */

export function ProductRowMenu({product, onBusy}: {product: AdminProductRow; onBusy?: (id: string | null) => void}) {
  const navigate = useNavigate();
  const toast = useToast();
  const dup = useDuplicateProduct();
  const {run, pending} = useRunOp();
  const edit = () => void navigate({to: '/products/$id', params: {id: product.id}});

  const ask = async (op: Op) => {
    onBusy?.(product.id);
    try {
      await run(op, [product], 0);
    } finally {
      onBusy?.(null);
    }
  };

  const duplicate = () => {
    onBusy?.(product.id);
    dup.mutate(product.id, {
      onSuccess: p => {
        toast.success(`Draft copy created: ${p.name}`);
        void navigate({to: '/products/$id', params: {id: p.id}});
      },
      onError: e => toast.danger(`The product could not be duplicated: ${messageOf(e)}`),
      onSettled: () => onBusy?.(null),
    });
  };

  const items: MenuItem[] = [
    {label: 'Edit', icon: 'pencil', onSelect: edit},
    {label: 'Duplicate as draft', icon: 'copy', onSelect: duplicate, disabled: dup.isPending},
    ...(product.status === 'published'
      ? [{label: 'View in store', icon: 'external' as const, onSelect: () => void window.open(`/product/${encodeURIComponent(product.id)}/`, '_blank', 'noopener,noreferrer')}]
      : []),
    'separator',
    ...STATUSES.filter(s => s !== product.status).map(s => ({label: OP[s].verb, icon: OP[s].icon, onSelect: () => void ask(s)})),
    'separator',
    {label: 'Delete…', icon: 'trash', danger: true, onSelect: () => void ask('delete')},
  ];
  return <Menu label={`Actions for ${product.name}`} items={items} disabled={pending || dup.isPending} />;
}

/* ---------- Bulk ---------- */

export function ProductsBulkBar({
  rows,
  onClear,
  onDone,
}: {
  rows: AdminProductRow[];
  onClear: () => void;
  /** Ids the action finished (deleted, archived or updated), so they can leave the selection */
  onDone: (ids: string[]) => void;
}) {
  const toast = useToast();
  const {run, pending} = useRunOp();
  const [op, setOp] = useState<Op | null>(null);

  const start = async (next: Op) => {
    const target = eligible(rows, next);
    if (!target.length) return;
    setOp(next);
    try {
      await run(next, target, rows.length - target.length, onDone);
    } finally {
      setOp(null);
    }
  };

  const exportRows = () => {
    downloadCsv(
      `varel-products-selected-${rows.length}.csv`,
      ['Name', 'Slug', 'SKU', 'Status', 'Department', 'Category', 'Price', 'Compare-at', 'Inventory', 'Variants'],
      rows.map(p => [p.name, p.id, p.sku, p.status, p.dept, p.category, p.price.toFixed(2), p.compareAt?.toFixed(2) ?? '', p.inventory, p.variantCount])
    );
    toast.success(`Exported ${pluralize(rows.length, 'product')}`);
  };

  return (
    <BulkBar count={rows.length} noun={['product', 'products']} onClear={onClear}>
      {STATUSES.map(s => {
        const n = eligible(rows, s).length;
        return (
          <BulkAction
            key={s}
            icon={OP[s].icon}
            disabled={!n || (pending && op !== s)}
            pending={pending && op === s}
            pendingLabel={OP[s].pending}
            hint={n ? undefined : `All selected products are already ${OP[s].done}`}
            onClick={() => void start(s)}>
            {OP[s].verb}
            {n > 0 && n < rows.length && <span className="bulk-action-count"> ({n})</span>}
          </BulkAction>
        );
      })}
      <BulkAction icon="download" disabled={pending} onClick={exportRows}>
        Export
      </BulkAction>
      <BulkAction icon="trash" danger disabled={pending && op !== 'delete'} pending={pending && op === 'delete'} pendingLabel={OP.delete.pending} onClick={() => void start('delete')}>
        Delete
      </BulkAction>
    </BulkBar>
  );
}
