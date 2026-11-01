import {useQuery} from '@tanstack/react-query';
import {Link, useParams} from '@tanstack/react-router';
import {type ReactNode, useEffect, useState} from 'react';

import type {AdminOrder, AdminOrderUpdate, OrderEvent} from '../../../lib/types/admin/sales';
import {ApiError} from '../../api';
import {orderQuery, useUpdateOrder} from '../../queries/orders';
import {
  Button,
  Card,
  DefinitionList,
  Field,
  Icon,
  PageHeader,
  rules,
  useConfirm,
  useForm,
  useToast,
} from '../../ui';
import {RefundDialog} from './RefundDialog';
import {
  BackLink,
  ConfirmModal,
  DetailSkeleton,
  dotJoin,
  errorText,
  formatDate,
  formatDateTime,
  isMissing,
  LoadFailed,
  minusMoney,
  money,
  pluralize,
  Status,
} from './ui';

/** `/dashboard/orders/$number` (VAREL src/pages/admin/orders/OrderDetail.tsx). */
export function OrderDetail() {
  const {number} = useParams({from: '/orders/$number'});
  const {data: order, isPending, error, refetch} = useQuery(orderQuery(number));
  const back = <BackLink to="/orders">Orders</BackLink>;

  if (isPending) return <DetailSkeleton />;
  if (!order) {
    const missing = isMissing(error);
    return (
      <div className="sales-screen">
        {back}
        <PageHeader title={number} />
        <LoadFailed
          error={error}
          title={missing ? 'There is no order with this number' : 'This order could not be loaded'}
          onRetry={missing ? undefined : () => void refetch()}
        />
      </div>
    );
  }
  return <OrderView order={order} back={back} />;
}

function OrderView({order, back}: {order: AdminOrder; back: ReactNode}) {
  const [refundOpen, setRefundOpen] = useState(false);
  const refunded = order.payment === 'Refunded';
  const confirmation = `/order/${encodeURIComponent(order.number)}/confirmation/?email=${encodeURIComponent(order.email)}`;

  return (
    <div className="sales-screen">
      {back}
      <PageHeader
        title={order.number}
        description={
          <span className="sales-header-meta">
            <span>{formatDateTime(order.placedAt)}</span>
            <Status status={order.payment} />
            <Status status={order.fulfillment} />
          </span>
        }
        actions={
          <>
            <a className="button button-ghost" href={confirmation} target="_blank" rel="noopener noreferrer">
              View as customer
              <Icon name="external" size={16} />
            </a>
            <Button
              variant="secondary"
              icon="rotate-ccw"
              disabled={order.payment !== 'Paid'}
              title={order.payment === 'Paid' || refunded ? undefined : 'Only paid orders can be refunded'}
              onClick={() => setRefundOpen(true)}>
              {refunded ? 'Refunded' : 'Refund'}
            </Button>
          </>
        }
      />

      <div className="sales-detail-grid">
        <div className="sales-stack">
          <ItemsCard order={order} />
          <FulfilmentCard order={order} />
          <TimelineCard events={order.events} />
        </div>
        <div className="sales-stack">
          <CustomerCard order={order} />
          <Card title="Shipping address">
            {order.address ? (
              <address className="sales-address">
                {order.address.name}
                <br />
                {order.address.line1}
                {order.address.line2 && (
                  <>
                    <br />
                    {order.address.line2}
                  </>
                )}
                <br />
                {order.address.zip} {order.address.city}
                <br />
                {order.address.country}
              </address>
            ) : (
              <p className="muted">No shipping address · digital order</p>
            )}
            <p className="sales-small muted">
              {order.method}
              {order.billingSameAsShipping ? ' · Billing same as shipping' : ''}
            </p>
          </Card>
          <PaymentCard order={order} />
          {order.customerNote && (
            <Card title="Customer note" description="Left at checkout">
              <p className="sales-prewrap">{order.customerNote}</p>
            </Card>
          )}
          <NoteCard order={order} />
          <ReturnsCard order={order} />
        </div>
      </div>

      <RefundDialog order={order} open={refundOpen} onClose={() => setRefundOpen(false)} />
    </div>
  );
}

/* ---------- Items + totals ---------- */

const thumb = (src: string) => (/^https:\/\/images\.unsplash\.com\//.test(src) ? `${src}${src.includes('?') ? '&' : '?'}auto=format&fit=crop&w=120&q=80` : src);

function ItemsCard({order}: {order: AdminOrder}) {
  const cur = order.currency;
  const free = order.discounts?.find(d => d.freeShipping);
  return (
    <Card title="Items" description={pluralize(order.count, 'unit')} flush>
      <ul className="sales-lines">
        {order.items.map(it => (
          <li key={it.lineId} className="sales-line">
            {it.image?.src ? <img className="sales-thumb" src={thumb(it.image.src)} alt="" loading="lazy" width={48} height={64} /> : <span className="sales-thumb" />}
            <div className="sales-line-text">
              <p className="sales-line-name">{it.name}</p>
              <p className="sales-small muted">{dotJoin(it.color, it.size, ...Object.values(it.options ?? {}), it.digital && 'Digital')}</p>
              <p className="sales-small sales-subtle">{it.sku}</p>
            </div>
            <div className="sales-line-money">
              {it.discount > 0 ? (
                <p>
                  <s className="sales-small sales-subtle">{money(it.total, cur)}</s> {money(Math.max(0, Math.round((it.total - it.discount) * 100) / 100), cur)}
                </p>
              ) : (
                <p>{money(it.total, cur)}</p>
              )}
              {it.discount > 0 && <p className="sales-small sales-positive">{minusMoney(it.discount, cur)} discount</p>}
              <p className="sales-small muted">
                {it.qty} × {money(it.price, cur)}
              </p>
            </div>
          </li>
        ))}
      </ul>
      <dl className="sales-totals">
        <div>
          <dt>Subtotal</dt>
          <dd>{money(order.subtotal, cur)}</dd>
        </div>
        {order.discounts?.length
          ? order.discounts
              .filter(d => d.amount > 0)
              .map(d => (
                <div key={d.id + d.label}>
                  <dt>
                    {d.label}
                    {d.automatic && <span className="sales-subtle"> · automatic</span>}
                  </dt>
                  <dd>{minusMoney(d.amount, cur)}</dd>
                </div>
              ))
          : order.discount > 0 && (
              <div>
                <dt>Discount{order.discountCode ? ` · ${order.discountCode}` : ''}</dt>
                <dd>{minusMoney(order.discount, cur)}</dd>
              </div>
            )}
        <div>
          <dt>Shipping</dt>
          <dd>{order.shipping === 0 ? dotJoin('Free', free?.code ?? free?.label) : money(order.shipping, cur)}</dd>
        </div>
        <div>
          <dt>Tax{order.pricesIncludeTax ? ' (included)' : ''}</dt>
          <dd>{money(order.tax, cur)}</dd>
        </div>
        <div className="sales-totals-grand">
          <dt>Total</dt>
          <dd>{money(order.total, cur)}</dd>
        </div>
      </dl>
    </Card>
  );
}

/* ---------- Fulfilment ---------- */

const STAGES = ['Placed', 'Packed', 'Shipped', 'Delivered'] as const;

function Stepper({stage}: {stage: number}) {
  return (
    <ol className="sales-stepper" aria-label="Fulfilment stage">
      {STAGES.map((label, i) => {
        const done = i + 1 <= stage;
        return (
          <li key={label} aria-current={i + 1 === stage ? 'step' : undefined} data-done={done ? '' : undefined}>
            <span className="sales-stepper-bar" />
            <span className="sales-stepper-label">
              {done && <Icon name="check" size={14} />}
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function FulfilmentCard({order}: {order: AdminOrder}) {
  const toast = useToast();
  const update = useUpdateOrder(order.number);
  const [shipOpen, setShipOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  const run = (key: string, body: AdminOrderUpdate, done: string) => {
    setPending(key);
    update.mutate(body, {
      onSuccess: () => toast.success(done),
      onError: e => toast.danger(errorText(e)),
      onSettled: () => setPending(null),
    });
  };

  const f = order.fulfillment;
  // A refunded order's fulfilment is closed (the API refuses moves); tracking stays editable.
  const open = order.payment !== 'Refunded';
  const canProcess = open && f === 'Unfulfilled';
  const canShip = open && (f === 'Unfulfilled' || f === 'Processing');
  const canDeliver = open && f === 'Shipped';
  const canEditTracking = f === 'Shipped';

  return (
    <Card title="Fulfilment" actions={<Status status={f} />}>
      <Stepper stage={order.stage} />

      {(order.carrier || order.tracking) && (
        <div className="sales-section">
          <DefinitionList
            items={[
              {label: 'Carrier', value: order.carrier ?? '—'},
              {
                label: 'Tracking',
                value: order.trackingUrl ? (
                  <a href={order.trackingUrl} target="_blank" rel="noopener noreferrer" className="sales-inline-link">
                    {order.tracking ?? 'Track'}
                    <Icon name="external" size={14} />
                  </a>
                ) : (
                  (order.tracking ?? '—')
                ),
              },
            ]}
          />
        </div>
      )}

      <div className="sales-actions">
        {canProcess && (
          <Button
            variant="secondary"
            size="sm"
            icon="package"
            pending={pending === 'processing'}
            pendingLabel="Saving…"
            disabled={!!pending}
            onClick={() => run('processing', {fulfillment: 'Processing'}, 'Marked as processing')}>
            Mark as processing
          </Button>
        )}
        {canShip && (
          <Button size="sm" icon="truck" disabled={!!pending} onClick={() => setShipOpen(true)}>
            Mark as shipped
          </Button>
        )}
        {canDeliver && (
          <Button
            size="sm"
            icon="check-circle"
            pending={pending === 'delivered'}
            pendingLabel="Saving…"
            disabled={!!pending}
            onClick={() => run('delivered', {fulfillment: 'Delivered'}, 'Marked as delivered')}>
            Mark as delivered
          </Button>
        )}
        {canEditTracking && (
          <Button variant="secondary" size="sm" disabled={!!pending} onClick={() => setShipOpen(true)}>
            Edit tracking
          </Button>
        )}
        {!canProcess && !canShip && !canDeliver && (
          <p className="muted sales-full">
            {f === 'Returned'
              ? 'This order was returned.'
              : !open && f !== 'Delivered'
                ? 'This order was refunded, so fulfilment is closed.'
                : 'This order is complete.'}
          </p>
        )}
      </div>

      <ShipDialog order={order} open={shipOpen} onClose={() => setShipOpen(false)} />
    </Card>
  );
}

const URL_RULE = rules.pattern(/^https?:\/\//i, 'Use a full URL starting with https://');
const max = (n: number) => rules.maxLength(n, `Keep this under ${n} characters`);

function ShipDialog({order, open, onClose}: {order: AdminOrder; open: boolean; onClose: () => void}) {
  const toast = useToast();
  const update = useUpdateOrder(order.number);
  const editing = order.fulfillment === 'Shipped';
  const form = useForm(
    {carrier: '', tracking: '', trackingUrl: ''},
    {carrier: [max(80)], tracking: [max(120)], trackingUrl: [max(500), URL_RULE]}
  );

  useEffect(() => {
    if (!open) return;
    form.reset({carrier: order.carrier ?? '', tracking: order.tracking ?? '', trackingUrl: order.trackingUrl ?? ''});
    update.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const fieldErrors = update.error instanceof ApiError && Object.keys(update.error.fields).length > 0;

  const submit = form.submit(values =>
    update.mutate(
      {
        ...(editing ? {} : {fulfillment: 'Shipped' as const}),
        carrier: values.carrier.trim() || null,
        tracking: values.tracking.trim() || null,
        trackingUrl: values.trackingUrl.trim() || null,
      },
      {
        onSuccess: () => {
          toast.success(editing ? 'Tracking updated' : 'Marked as shipped');
          onClose();
        },
        onError: e => {
          if (e instanceof ApiError) form.setServerErrors(e.fields);
        },
      }
    )
  );

  return (
    <ConfirmModal
      open={open}
      onClose={onClose}
      title={editing ? 'Edit tracking' : 'Mark as shipped'}
      description={
        editing
          ? "Update the carrier and tracking details. They show on the customer's order page."
          : "Add the carrier and tracking details for this shipment. They show on the customer's order page, and the customer gets the shipping email when it is switched on in Settings › Emails."
      }
      confirmLabel={editing ? 'Save tracking' : 'Mark as shipped'}
      pendingLabel="Saving…"
      pending={update.isPending}
      error={update.error && !fieldErrors ? errorText(update.error) : null}
      formId="ship-form">
      <form id="ship-form" className="form-stack" noValidate onSubmit={submit}>
        <Field label="Carrier" id="f-carrier" error={form.error('carrier')} optional>
          <input {...form.field('carrier')} placeholder="DHL Express" autoComplete="off" />
        </Field>
        <Field label="Tracking number" id="f-tracking" error={form.error('tracking')} optional>
          <input {...form.field('tracking')} placeholder="JJD0099887766" autoComplete="off" />
        </Field>
        <Field label="Tracking URL" id="f-trackingUrl" error={form.error('trackingUrl')} optional>
          <input {...form.field('trackingUrl')} type="url" inputMode="url" placeholder="https://" autoComplete="off" />
        </Field>
      </form>
    </ConfirmModal>
  );
}

/* ---------- Side cards ---------- */

function PaymentCard({order}: {order: AdminOrder}) {
  const toast = useToast();
  const confirm = useConfirm();
  const update = useUpdateOrder(order.number);
  // Checkout charges the card up front; a pending or failed payment can be settled manually (bank transfer, retry).
  const canMarkPaid = order.payment === 'Pending' || order.payment === 'Failed';
  const markPaid = async () => {
    const ok = await confirm({
      title: `Mark ${order.number} as paid?`,
      body: `Use this when ${money(order.total, order.currency)} has been received outside checkout. The change is logged in the timeline. No email is sent.`,
      confirmLabel: 'Mark as paid',
      pendingLabel: 'Saving…',
      tone: 'primary',
      action: () => update.mutateAsync({payment: 'Paid'}),
    });
    if (ok) toast.success(`${order.number} marked as paid`);
  };
  return (
    <Card title="Payment" actions={<Status status={order.payment} />}>
      <DefinitionList
        items={[
          {label: 'Card', value: order.cardBrand ? `${order.cardBrand} •••• ${order.cardLast4 ?? ''}` : '—'},
          {label: 'Total', value: money(order.total, order.currency)},
        ]}
      />
      {canMarkPaid && (
        <div className="sales-actions">
          <Button variant="secondary" size="sm" icon="check" onClick={() => void markPaid()}>
            Mark as paid
          </Button>
        </div>
      )}
    </Card>
  );
}

function CustomerCard({order}: {order: AdminOrder}) {
  const c = order.customer;
  return (
    <Card title="Customer" actions={!c && <Status status="Guest" />}>
      <div className="sales-customer-card">
        {c ? (
          <Link to="/customers/$id" params={{id: c.id}} className="sales-customer-link">
            {c.name}
          </Link>
        ) : (
          <p className="sales-customer-link">{order.address?.name ?? 'Guest'}</p>
        )}
        <p>
          <a href={`mailto:${order.email}`} className="sales-break">
            {order.email}
          </a>
        </p>
        <p className="muted">{order.phone ?? 'No phone number'}</p>
        {!c && <p className="sales-small sales-subtle">Guest checkout · no account</p>}
      </div>
    </Card>
  );
}

const NOTE_MAX = 2000;

function NoteCard({order}: {order: AdminOrder}) {
  const toast = useToast();
  const update = useUpdateOrder(order.number);
  const [note, setNote] = useState(order.note ?? '');
  useEffect(() => setNote(order.note ?? ''), [order.note]);
  const dirty = note.trim() !== (order.note ?? '').trim();
  const tooLong = note.trim().length > NOTE_MAX;

  return (
    <Card title="Staff note" description="Internal · not shown to the customer">
      <div className="field" data-invalid={tooLong ? '' : undefined}>
        <label htmlFor="staff-note" className="visually-hidden">
          Staff note
        </label>
        <textarea
          id="staff-note"
          rows={4}
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Add a note for the team"
          aria-invalid={tooLong || undefined}
          aria-describedby={tooLong ? 'staff-note-error' : undefined}
        />
        {tooLong && (
          <p className="field-error" id="staff-note-error" role="alert">
            Keep this under {NOTE_MAX} characters
          </p>
        )}
      </div>
      <div className="sales-actions sales-actions-end">
        {dirty && (
          <Button variant="ghost" size="sm" disabled={update.isPending} onClick={() => setNote(order.note ?? '')}>
            Discard
          </Button>
        )}
        <Button
          variant="secondary"
          size="sm"
          disabled={!dirty || tooLong}
          pending={update.isPending}
          pendingLabel="Saving…"
          onClick={() =>
            update.mutate({note: note.trim() || null}, {onSuccess: () => toast.success('Note saved'), onError: e => toast.danger(errorText(e))})
          }>
          Save note
        </Button>
      </div>
    </Card>
  );
}

function ReturnsCard({order}: {order: AdminOrder}) {
  if (!order.returns.length) return null;
  return (
    <Card title="Returns" flush>
      <ul className="list">
        {order.returns.map(r => (
          <li key={r.id}>
            <Link to="/returns/$id" params={{id: r.id}} className="sales-return-link">
              <span className="sales-line-text">
                <span className="sales-line-name">#{r.id}</span>
                <span className="cell-sub">{dotJoin(formatDate(r.createdAt), pluralize(r.itemCount, 'item'), money(r.amount, order.currency))}</span>
              </span>
              <Status status={r.status} />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ---------- Timeline ---------- */

function TimelineCard({events}: {events: OrderEvent[]}) {
  return (
    <Card title="Timeline">
      {events.length === 0 ? (
        <p className="muted">No activity yet.</p>
      ) : (
        <ol className="sales-timeline">
          {events.map((e, i) => (
            <li key={`${e.at}-${i}`} data-latest={i === 0 ? '' : undefined}>
              <p>{e.message}</p>
              <p className="sales-small sales-subtle">{dotJoin(formatDateTime(e.at), e.by ?? 'System')}</p>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

