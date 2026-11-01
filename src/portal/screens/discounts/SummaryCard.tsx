import {minusMoney, money} from '../../../lib/format';
import type {AdminDiscount, DiscountStatus} from '../../../lib/types/admin/promotions';
import {Card, StatusBadge} from '../../ui';
import {STATUS_LABEL, STATUS_TONES, sampleSaving, type PromoForm} from './helpers';

/** Sticky side cards: the live plain-language rule and a preview of the bag row the customer sees. */
export function SummaryCard({form, summary, status, discount}: {form: PromoForm; summary: string; status: DiscountStatus; discount?: AdminDiscount}) {
  const code = form.method === 'code' ? (form.codeType === 'shared' ? form.code.trim().toUpperCase() || 'CODE' : 'UNIQUE-CODE') : null;
  const prefix = code ?? (form.name.trim() || 'Offer');
  const label = form.label.trim() || '…';
  const rowLabel = `${prefix} · ${label}`;
  const sample = sampleSaving(form);
  const productNote = form.method === 'automatic' && (form.eligibility === 'everyone' || form.eligibility === 'signed_in') && form.scope !== 'order';

  return (
    <>
      <Card title="Summary" actions={<StatusBadge tone={STATUS_TONES[status]}>{STATUS_LABEL[status]}</StatusBadge>}>
        <p className="discount-summary-text" data-testid="live-summary" aria-live="polite">
          {summary}
        </p>
        <dl className="discount-facts">
          <dt>Method</dt>
          <dd>
            {form.method === 'automatic' ? 'Automatic' : form.codeType === 'unique' ? 'Unique codes' : 'Code'}
            {form.method === 'code' && form.codeType === 'shared' && form.code && <span className="mono"> · {form.code.toUpperCase()}</span>}
          </dd>
          <dt>Combines</dt>
          <dd>
            {form.combinable ? 'Yes' : 'No'} · priority {form.priority || 0}
          </dd>
          {discount && (
            <>
              <dt>Uses</dt>
              <dd className="num">
                {discount.used} / {discount.usageLimit ?? '∞'}
                {discount.codeType === 'unique' && ` · ${discount.codesUsed} of ${discount.codesTotal} codes used`}
              </dd>
              <dt>Given</dt>
              <dd className="num">
                {money(discount.totalDiscounted ?? 0)} on {money(discount.revenue ?? 0)} revenue
              </dd>
            </>
          )}
        </dl>
      </Card>

      <Card title="What the customer sees" description={`Example: ${sample.text}.`}>
        <div className="bag-preview" data-testid="bag-preview">
          {form.scope !== 'order' && sample.amount != null && sample.amount > 0 && (
            <div className="bag-line">
              <span className="bag-line-text">
                <span className="bag-line-name">Qualifying item</span>
                <span className="line-discount-note">{label}</span>
              </span>
              <span className="bag-line-price">
                <s className="muted">{money(sample.subtotal)}</s>
                <span>{money(Math.max(0, sample.subtotal - sample.amount))}</span>
              </span>
            </div>
          )}
          <dl className="bag-totals">
            <div>
              <dt className="muted">Subtotal</dt>
              <dd className="num">{money(sample.subtotal)}</dd>
            </div>
            {sample.amount != null ? (
              <div className="bag-saving">
                <dt>{rowLabel}</dt>
                <dd className="num">{minusMoney(sample.amount)}</dd>
              </div>
            ) : (
              <div>
                <dt className="muted">Shipping</dt>
                <dd className="bag-saving">Free · {code ?? label}</dd>
              </div>
            )}
          </dl>
          {form.note.trim() && <p className="bag-note">{form.note.trim()}</p>}
        </div>
        {productNote && (
          <p className="discount-side-note">
            Product cards and pages in scope also show “<strong>{label} in your bag</strong>”.
          </p>
        )}
        {form.method === 'code' && form.codeType === 'unique' && <p className="discount-side-note muted">Each customer enters their own single-use code.</p>}
      </Card>
    </>
  );
}
