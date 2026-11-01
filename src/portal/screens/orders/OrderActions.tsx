/* Row and bulk actions for the orders list (port of VAREL src/pages/admin/orders/OrderActions.tsx).
   Status moves mirror the order detail screen: Unfulfilled → Processing → Shipped → Delivered;
   refunds stay one order at a time. */

import {useNavigate} from '@tanstack/react-router';
import {useState} from 'react';

import type {AdminOrderRow, FulfillmentStatus} from '../../../lib/types/admin/sales';
import {useBulkUpdateOrders} from '../../queries/orders';
import {BulkAction, BulkBar, type IconName, Menu, type MenuItem, useToast} from '../../ui';
import {RefundDialog} from './RefundDialog';
import {ConfirmModal, csvText, errorText, money, pluralize, saveBlob} from './ui';

export type Move = 'Processing' | 'Shipped' | 'Delivered';

/** Which fulfilment states each move applies to. */
export const FROM: Record<Move, FulfillmentStatus[]> = {
  Processing: ['Unfulfilled'],
  Shipped: ['Unfulfilled', 'Processing'],
  Delivered: ['Shipped'],
};

export const canMove = (o: Pick<AdminOrderRow, 'fulfillment' | 'payment'>, to: Move) =>
  FROM[to].includes(o.fulfillment) && o.payment !== 'Refunded';

/* ---------- Single row ---------- */

export function OrderRowMenu({
  order,
  busy,
  onBusy,
}: {
  order: AdminOrderRow;
  /** Another row (or this one) is being moved: the menu waits. */
  busy: boolean;
  onBusy: (number: string | null) => void;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const update = useBulkUpdateOrders();
  const [refunding, setRefunding] = useState(false);
  const open = () => void navigate({to: '/orders/$number', params: {number: order.number}});

  const move = (to: Move) => {
    onBusy(order.number);
    update.mutate(
      {numbers: [order.number], body: {fulfillment: to}},
      {
        onSuccess: ({failed}) =>
          failed.length ? toast.danger(errorText(failed[0]!.error)) : toast.success(`${order.number} marked as ${to.toLowerCase()}`),
        onError: e => toast.danger(errorText(e)),
        onSettled: () => onBusy(null),
      }
    );
  };

  const moves: MenuItem[] = [
    ...(canMove(order, 'Processing') ? [{label: 'Mark as processing', icon: 'package' as IconName, onSelect: () => move('Processing')}] : []),
    // Shipping from a row goes through the detail screen so carrier and tracking are captured.
    ...(canMove(order, 'Shipped') ? [{label: 'Ship with tracking…', icon: 'truck' as IconName, onSelect: open}] : []),
    ...(canMove(order, 'Delivered') ? [{label: 'Mark as delivered', icon: 'check-circle' as IconName, onSelect: () => move('Delivered')}] : []),
  ];

  const items: MenuItem[] = [
    {label: 'View order', icon: 'eye', onSelect: open},
    {
      label: 'Copy order number',
      icon: 'copy',
      onSelect: () =>
        void navigator.clipboard.writeText(order.number).then(
          () => toast.success(`${order.number} copied`),
          () => toast.danger('The order number could not be copied')
        ),
    },
    {
      label: 'Email customer',
      icon: 'mail',
      onSelect: () => {
        window.location.href = `mailto:${order.email}?subject=${encodeURIComponent(`Your VAREL order ${order.number}`)}`;
      },
    },
    ...(moves.length ? ['separator' as const, ...moves] : []),
    ...(order.payment === 'Paid'
      ? [
          'separator' as const,
          {label: `Refund ${money(order.total, order.currency)}…`, icon: 'rotate-ccw' as IconName, danger: true, onSelect: () => setRefunding(true)},
        ]
      : []),
  ];

  return (
    <>
      <Menu label={`Actions for ${order.number}`} items={items} disabled={busy} />
      <RefundDialog order={order} open={refunding} onClose={() => setRefunding(false)} />
    </>
  );
}

/* ---------- Bulk ---------- */

const MOVE_COPY: Record<Move, {verb: string; icon: IconName; note?: string}> = {
  Processing: {verb: 'Mark processing', icon: 'package'},
  Shipped: {
    verb: 'Mark shipped',
    icon: 'truck',
    note: 'Carrier and tracking can be added on each order afterwards. Customers get the shipping email when it is switched on in Settings › Emails.',
  },
  Delivered: {verb: 'Mark delivered', icon: 'check-circle'},
};

export function OrdersBulkBar({
  rows,
  onClear,
  onDone,
}: {
  rows: AdminOrderRow[];
  onClear: () => void;
  /** Called with the order numbers that failed; only those stay selected for a retry. */
  onDone: (failed: string[]) => void;
}) {
  const toast = useToast();
  const update = useBulkUpdateOrders();
  const [pending, setPending] = useState<Move | null>(null);

  const eligible = (to: Move) => rows.filter(o => canMove(o, to));
  const target = pending ? eligible(pending) : [];
  const skipped = rows.length - target.length;

  const run = () => {
    if (!pending) return;
    const to = pending;
    update.mutate(
      {numbers: target.map(o => o.number), body: {fulfillment: to}},
      {
        onSuccess: ({updated, failed}) => {
          if (updated.length) toast.success(`${pluralize(updated.length, 'order')} marked as ${to.toLowerCase()}`);
          if (failed.length) toast.danger(`${failed.map(f => f.number).join(', ')} could not be updated: ${errorText(failed[0]!.error)}`);
          onDone(failed.map(f => f.number));
          setPending(null);
        },
      }
    );
  };

  const exportRows = () => {
    saveBlob(new Blob([csvText(selectedCsvRows(rows))], {type: 'text/csv;charset=utf-8'}), `varel-orders-selected-${rows.length}.csv`);
    toast.success(`Exported ${pluralize(rows.length, 'order')}`);
  };

  return (
    <>
      <BulkBar count={rows.length} noun={['order', 'orders']} onClear={onClear}>
        {(Object.keys(MOVE_COPY) as Move[]).map(to => {
          const n = eligible(to).length;
          const {verb, icon} = MOVE_COPY[to];
          return (
            <BulkAction
              key={to}
              icon={icon}
              disabled={!n}
              hint={n ? undefined : `None of the selected orders can be marked ${to.toLowerCase()}`}
              onClick={() => {
                update.reset();
                setPending(to);
              }}>
              {verb}
              {n > 0 && n < rows.length && ` (${n})`}
            </BulkAction>
          );
        })}
        <BulkAction icon="download" onClick={exportRows}>
          Export
        </BulkAction>
      </BulkBar>

      <ConfirmModal
        open={!!pending}
        onClose={() => setPending(null)}
        title={pending ? `Mark ${pluralize(target.length, 'order')} as ${pending.toLowerCase()}?` : ''}
        description={pending ? MOVE_COPY[pending].note : undefined}
        confirmLabel={pending ? MOVE_COPY[pending].verb : 'Confirm'}
        pendingLabel="Updating…"
        pending={update.isPending}
        error={update.error ? errorText(update.error) : null}
        onConfirm={run}>
        <ul className="sales-confirm-list">
          {target.map(o => (
            <li key={o.number}>
              <span>
                {o.number} <span className="muted">· {o.customerName}</span>
              </span>
              <span className="muted">{o.fulfillment}</span>
            </li>
          ))}
        </ul>
        {skipped > 0 && (
          <p className="modal-text">
            {pluralize(skipped, 'selected order')} {skipped === 1 ? 'is' : 'are'} skipped because {skipped === 1 ? 'it is' : 'they are'} already
            further along, returned or refunded.
          </p>
        )}
      </ConfirmModal>
    </>
  );
}

/** Client-side CSV of the selected rows (the server export covers whole filtered lists). */
export function selectedCsvRows(rows: AdminOrderRow[]): (string | number)[][] {
  return [
    ['Order', 'Placed', 'Customer', 'Email', 'Payment', 'Fulfilment', 'Items', 'Total'],
    ...rows.map(o => [o.number, o.placedAt, o.customerName, o.email, o.payment, o.fulfillment, o.count, o.total.toFixed(2)]),
  ];
}
