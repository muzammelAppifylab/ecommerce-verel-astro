/* Row and bulk actions for returns (port of VAREL src/pages/admin/returns/actions.tsx).
   Moves follow RETURN_NEXT (the same table the API enforces):
   Requested → Approved | Rejected · Approved → Received | Refunded | Rejected · Received → Refunded · Rejected → Requested.
   Refunds stay one return at a time: they move money and restock items. */

import {useNavigate} from '@tanstack/react-router';
import {useState} from 'react';

import type {AdminReturnRow, ReturnStatus} from '../../../lib/types/admin/sales';
import {RETURN_NEXT, useBulkUpdateReturns} from '../../queries/returns';
import {BulkAction, BulkBar, type IconName, Menu, type MenuItem, useConfirm, useToast} from '../../ui';
import {ConfirmModal, errorText, money, pluralize} from '../orders/ui';

type Move = Exclude<ReturnStatus, 'Refunded'>;

export const MOVE: Record<Move, {verb: string; done: string; icon: IconName; note: string}> = {
  Approved: {verb: 'Approve', done: 'approved', icon: 'check', note: 'The customer can send the items back.'},
  Rejected: {verb: 'Reject', done: 'rejected', icon: 'x', note: 'No refund is made and nothing is restocked.'},
  Received: {verb: 'Mark received', done: 'marked as received', icon: 'check-circle', note: 'The items have arrived at the studio. Refund them next.'},
  Requested: {verb: 'Reopen', done: 'reopened', icon: 'rotate-ccw', note: 'The return goes back to requested for review.'},
};

/** What the customer hears about a status change (VAREL said "No email is sent", but the server sends return_update). */
export const RETURN_EMAIL_NOTE = 'Customers get the return update email when it is switched on in Settings › Emails.';

export const canMove = (r: Pick<AdminReturnRow, 'status'>, to: ReturnStatus) => RETURN_NEXT[r.status].includes(to);

/** The refund confirmation copy for one return (restocks the returned lines). */
export const refundReturnConfirm = (ret: Pick<AdminReturnRow, 'amount' | 'itemCount'> & {orderNumber: string}, currency?: string) => ({
  title: `Refund ${money(ret.amount, currency)}`,
  body: `Refunds ${money(ret.amount, currency)} for this return and puts ${pluralize(ret.itemCount, 'item')} back in stock. ${ret.orderNumber} is marked Returned, and Refunded once every line has come back. ${RETURN_EMAIL_NOTE} This cannot be undone.`,
  confirmLabel: 'Refund return',
  pendingLabel: 'Refunding…',
  tone: 'danger' as const,
});

/* ---------- Single row ---------- */

export function ReturnRowMenu({ret, busy, onBusy}: {ret: AdminReturnRow; busy: boolean; onBusy: (id: string | null) => void}) {
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const update = useBulkUpdateReturns();

  /** One move; throws on failure so a confirm dialog shows the error in place. */
  const moveAsync = async (status: ReturnStatus) => {
    onBusy(ret.id);
    try {
      const {failed} = await update.mutateAsync({ids: [ret.id], status});
      if (failed.length) throw new Error(errorText(failed[0]!.error));
      toast.success(
        status === 'Refunded' ? `Return for ${ret.orderNumber} refunded · items restocked` : `Return for ${ret.orderNumber} ${MOVE[status].done}`
      );
    } finally {
      onBusy(null);
    }
  };
  const move = (status: ReturnStatus) => void moveAsync(status).catch(e => toast.danger(errorText(e)));

  const moves = (['Approved', 'Received', 'Requested'] as const).filter(m => canMove(ret, m));
  const actions: MenuItem[] = [
    ...moves.map(m => ({label: MOVE[m].verb, icon: MOVE[m].icon, onSelect: () => move(m)})),
    ...(canMove(ret, 'Refunded')
      ? [
          {
            label: `Refund ${money(ret.amount)}…`,
            icon: 'rotate-ccw' as IconName,
            onSelect: () => void confirm({...refundReturnConfirm(ret), action: () => moveAsync('Refunded')}),
          },
        ]
      : []),
    ...(canMove(ret, 'Rejected')
      ? [
          {
            label: 'Reject…',
            icon: 'x' as IconName,
            danger: true,
            onSelect: () =>
              void confirm({
                title: `Reject the return for ${ret.orderNumber}?`,
                body: `${MOVE.Rejected.note} It can be reopened later. ${RETURN_EMAIL_NOTE}`,
                confirmLabel: 'Reject return',
                pendingLabel: 'Rejecting…',
                tone: 'danger',
                action: () => moveAsync('Rejected'),
              }),
          },
        ]
      : []),
  ];

  const items: MenuItem[] = [
    {label: 'View return', icon: 'eye', onSelect: () => void navigate({to: '/returns/$id', params: {id: ret.id}})},
    {label: `View order ${ret.orderNumber}`, icon: 'shopping-bag', onSelect: () => void navigate({to: '/orders/$number', params: {number: ret.orderNumber}})},
    {
      label: 'Email customer',
      icon: 'mail',
      onSelect: () => {
        window.location.href = `mailto:${ret.email}?subject=${encodeURIComponent(`Your VAREL return for ${ret.orderNumber}`)}`;
      },
    },
    {
      label: 'Copy email',
      icon: 'copy',
      onSelect: () =>
        void navigator.clipboard.writeText(ret.email).then(
          () => toast.success('Email copied'),
          () => toast.danger('The email could not be copied')
        ),
    },
    ...(actions.length ? ['separator' as const, ...actions] : []),
  ];

  return <Menu label={`Actions for return #${ret.id}`} items={items} disabled={busy} />;
}

/* ---------- Bulk ---------- */

const BULK: Move[] = ['Approved', 'Received', 'Rejected'];

export function ReturnsBulkBar({rows, onClear, onDone}: {rows: AdminReturnRow[]; onClear: () => void; onDone: (updated: string[]) => void}) {
  const toast = useToast();
  const update = useBulkUpdateReturns();
  const [pending, setPending] = useState<Move | null>(null);
  const eligible = (to: Move) => rows.filter(r => canMove(r, to));
  const target = pending ? eligible(pending) : [];
  const skipped = rows.length - target.length;

  const run = () => {
    if (!pending) return;
    const to = pending;
    update.mutate(
      {ids: target.map(r => r.id), status: to},
      {
        onSuccess: ({updated, failed}) => {
          if (updated.length) toast.success(`${pluralize(updated.length, 'return')} ${MOVE[to].done}`);
          if (failed.length) toast.danger(`${failed.map(f => `#${f.id}`).join(', ')} could not be updated: ${errorText(failed[0]!.error)}`);
          onDone(updated.map(r => r.id));
          setPending(null);
        },
      }
    );
  };

  return (
    <>
      <BulkBar count={rows.length} noun={['return', 'returns']} onClear={onClear}>
        {BULK.map(to => {
          const n = eligible(to).length;
          return (
            <BulkAction
              key={to}
              icon={MOVE[to].icon}
              danger={to === 'Rejected'}
              disabled={!n}
              hint={n ? undefined : `None of the selected returns can be ${MOVE[to].done}`}
              onClick={() => {
                update.reset();
                setPending(to);
              }}>
              {MOVE[to].verb}
              {n > 0 && n < rows.length && ` (${n})`}
            </BulkAction>
          );
        })}
      </BulkBar>

      <ConfirmModal
        open={!!pending}
        onClose={() => setPending(null)}
        title={pending ? `${MOVE[pending].verb} ${pluralize(target.length, 'return')}?` : ''}
        description={pending ? `${MOVE[pending].note} ${RETURN_EMAIL_NOTE}` : undefined}
        confirmLabel={pending ? `${MOVE[pending].verb} ${pluralize(target.length, 'return')}` : 'Confirm'}
        pendingLabel="Updating…"
        tone={pending === 'Rejected' ? 'danger' : 'primary'}
        pending={update.isPending}
        error={update.error ? errorText(update.error) : null}
        onConfirm={run}>
        <ul className="sales-confirm-list">
          {target.map(r => (
            <li key={r.id}>
              <span>
                {r.orderNumber}{' '}
                <span className="muted">
                  · {r.email} · {money(r.amount)}
                </span>
              </span>
              <span className="muted">{r.status}</span>
            </li>
          ))}
        </ul>
        {skipped > 0 && (
          <p className="modal-text">
            {pluralize(skipped, 'selected return')} {skipped === 1 ? 'is' : 'are'} skipped because {skipped === 1 ? 'its' : 'their'} status does not
            allow this step.
          </p>
        )}
      </ConfirmModal>
    </>
  );
}
