import {useQuery} from '@tanstack/react-query';
import {Link, useParams} from '@tanstack/react-router';
import {type ReactNode, useState} from 'react';

import type {AdminReturn, ReturnStatus} from '../../../lib/types/admin/sales';
import {RETURN_NEXT, returnQuery, useUpdateReturn} from '../../queries/returns';
import {Button, Card, DefinitionList, Field, Icon, PageHeader, useConfirm, useToast} from '../../ui';
import {BackLink, DetailSkeleton, dotJoin, errorText, formatDateTime, isMissing, LoadFailed, money, pluralize, Status} from '../orders/ui';
import {MOVE, refundReturnConfirm, RETURN_EMAIL_NOTE} from './actions';

/** Primary next step per status, and what it means for the team. */
const GUIDE: Record<ReturnStatus, {primary?: ReturnStatus; text: string}> = {
  Requested: {primary: 'Approved', text: 'Review the reasons. Approve to let the customer send the items back, or reject.'},
  Approved: {primary: 'Received', text: 'Waiting for the parcel. Mark it received once the items are checked, then refund.'},
  Received: {primary: 'Refunded', text: 'The items are back. Refund to pay the customer and restock the pieces.'},
  Rejected: {text: 'This return was rejected. Reopen it if the decision changes.'},
  Refunded: {text: 'Refunded and restocked. Nothing left to do.'},
};

const LABEL: Record<ReturnStatus, string> = {
  Approved: 'Approve',
  Received: 'Mark received',
  Refunded: 'Refund',
  Rejected: 'Reject',
  Requested: 'Reopen',
};

const DONE: Record<ReturnStatus, string> = {
  Requested: 'Return reopened',
  Approved: 'Return approved',
  Rejected: 'Return rejected',
  Received: 'Return marked as received',
  Refunded: 'Return refunded · items restocked',
};

const NOTE_MAX = 2000;

/** `/dashboard/returns/$id` (VAREL src/pages/admin/returns/ReturnDetail.tsx). */
export function ReturnDetail() {
  const {id} = useParams({from: '/returns/$id'});
  const {data, isPending, error, refetch} = useQuery(returnQuery(id));
  const back = <BackLink to="/returns">Returns</BackLink>;

  if (isPending) return <DetailSkeleton />;
  if (!data) {
    const missing = isMissing(error);
    return (
      <div className="sales-screen">
        {back}
        <PageHeader title={`Return ${id}`} />
        <LoadFailed
          error={error}
          title={missing ? 'There is no return with this ID' : 'This return could not be loaded'}
          onRetry={missing ? undefined : () => void refetch()}
        />
      </div>
    );
  }
  return <ReturnView ret={data} back={back} />;
}

function ReturnView({ret, back}: {ret: AdminReturn; back: ReactNode}) {
  const toast = useToast();
  const confirm = useConfirm();
  const update = useUpdateReturn(ret.id);
  const [note, setNote] = useState('');
  const [pending, setPending] = useState<ReturnStatus | null>(null);
  const guide = GUIDE[ret.status];
  // Primary step first, reject last (it ends the return).
  const moves = [...RETURN_NEXT[ret.status]].sort(
    (a, b) => Number(b === guide.primary) - Number(a === guide.primary) || Number(a === 'Rejected') - Number(b === 'Rejected')
  );
  const orderRefunded = ret.order.payment === 'Refunded';
  const cur = ret.order.currency;
  const tooLong = note.trim().length > NOTE_MAX;

  /** Applies a move; throws on failure (a confirm dialog shows it in place). */
  const apply = async (status: ReturnStatus) => {
    setPending(status);
    try {
      await update.mutateAsync({status, note: note.trim() || undefined});
      toast.success(DONE[status]);
      setNote('');
    } finally {
      setPending(null);
    }
  };

  const click = (status: ReturnStatus) => {
    if (tooLong) {
      document.getElementById('return-note')?.focus();
      return;
    }
    if (status === 'Refunded') {
      void confirm({...refundReturnConfirm({...ret, orderNumber: ret.order.number}, cur), action: () => apply('Refunded')});
    } else if (status === 'Rejected') {
      void confirm({
        title: `Reject return #${ret.id}?`,
        body: `${MOVE.Rejected.note} It can be reopened later. ${RETURN_EMAIL_NOTE}`,
        confirmLabel: 'Reject return',
        pendingLabel: 'Rejecting…',
        tone: 'danger',
        action: () => apply('Rejected'),
      });
    } else {
      void apply(status).catch(e => toast.danger(errorText(e)));
    }
  };

  return (
    <div className="sales-screen">
      {back}
      <PageHeader
        title={`Return for ${ret.orderNumber}`}
        description={
          <span className="sales-header-meta">
            <span>{dotJoin(`Requested ${formatDateTime(ret.createdAt)}`, ret.email)}</span>
            <span className="sales-subtle">#{ret.id}</span>
            <Status status={ret.status} />
          </span>
        }
      />

      <div className="sales-detail-grid">
        <div className="sales-stack">
          <Card title="Returned items" description={pluralize(ret.itemCount, 'item')} flush>
            <ul className="sales-lines">
              {ret.items.map(it => (
                <li key={it.lineId} className="sales-line">
                  <div className="sales-line-text">
                    <p className="sales-line-name">{it.name}</p>
                    <p className="sales-small muted">{dotJoin(it.color, it.size, ...Object.values(it.options ?? {}), it.sku)}</p>
                    <p className="sales-reason">
                      <span className="sales-subtle">Reason · </span>
                      {it.reason || '—'}
                    </p>
                  </div>
                  <div className="sales-line-money">
                    <p>{money(it.price * it.qty, cur)}</p>
                    <p className="sales-small muted">
                      {it.qty} × {money(it.price, cur)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
            <div className="sales-refund-total">
              <span>Refund amount</span>
              <span>{money(ret.amount, cur)}</span>
            </div>
          </Card>

          {ret.note && (
            <Card title="Notes">
              <p className="sales-prewrap">{ret.note}</p>
            </Card>
          )}
        </div>

        <div className="sales-stack">
          <Card title="Next step" actions={<Status status={ret.status} />}>
            <p className="muted">{guide.text}</p>
            {moves.length > 0 && (
              <>
                <div className="sales-section">
                  <Field
                    label="Note"
                    id="return-note"
                    optional
                    hint="Saved with the status change and shown in the order timeline."
                    error={tooLong ? `Keep this under ${NOTE_MAX} characters` : undefined}>
                    <textarea
                      id="return-note"
                      rows={3}
                      value={note}
                      onChange={e => setNote(e.target.value)}
                      placeholder="Optional"
                      aria-invalid={tooLong || undefined}
                      aria-describedby={tooLong ? 'return-note-error' : 'return-note-hint'}
                    />
                  </Field>
                </div>
                <div className="sales-actions">
                  {moves.map(m => {
                    const blocked = m === 'Refunded' && orderRefunded;
                    return (
                      <Button
                        key={m}
                        size="sm"
                        variant={m === guide.primary ? 'primary' : m === 'Rejected' ? 'danger' : 'secondary'}
                        disabled={(!!pending && pending !== m) || blocked}
                        title={blocked ? 'The whole order has already been refunded' : undefined}
                        pending={pending === m && m !== 'Refunded' && m !== 'Rejected'}
                        pendingLabel="Saving…"
                        onClick={() => click(m)}>
                        {LABEL[m]}
                      </Button>
                    );
                  })}
                </div>
                {orderRefunded && moves.includes('Refunded') && (
                  <p className="sales-small sales-subtle sales-section">
                    {ret.order.number} was refunded in full, so this return cannot be refunded again. Reject it or leave it as is.
                  </p>
                )}
              </>
            )}
          </Card>

          <Card
            title="Order"
            actions={
              <Link to="/orders/$number" params={{number: ret.order.number}} className="sales-inline-link">
                Open order
                <Icon name="external" size={14} />
              </Link>
            }>
            <DefinitionList
              items={[
                {label: 'Number', value: ret.order.number},
                {label: 'Placed', value: formatDateTime(ret.order.placedAt)},
                {label: 'Customer', value: ret.order.customerName},
                {
                  label: 'Email',
                  value: (
                    <a
                      href={`mailto:${ret.order.email}?subject=${encodeURIComponent(`Your VAREL return for ${ret.order.number}`)}`}
                      className="sales-break">
                      {ret.order.email}
                    </a>
                  ),
                },
                {label: 'Payment', value: <Status status={ret.order.payment} />},
                {label: 'Fulfilment', value: <Status status={ret.order.fulfillment} />},
                {label: 'Total', value: money(ret.order.total, cur)},
              ]}
            />
          </Card>
        </div>
      </div>
    </div>
  );
}
