import {useQuery} from '@tanstack/react-query';
import {type FormEvent, useEffect, useState} from 'react';

import type {AdminOrder} from '../../../lib/types/admin/sales';
import {orderQuery, useRefundOrder} from '../../queries/orders';
import {Checkbox, Field, useToast} from '../../ui';
import {ConfirmModal, errorText, money, pluralize} from './ui';

const NOTE_MAX = 500;

/**
 * Full refund with optional restock (VAREL RefundDialog). Also opened from the orders list,
 * where only the row fields exist: the full order is loaded when it opens to net out returns
 * that were already refunded (amount and units), as the server does.
 */
export function RefundDialog({
  order,
  open,
  onClose,
}: {
  order: Pick<AdminOrder, 'number' | 'total' | 'count' | 'currency'> & {cardBrand?: string | null};
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const refund = useRefundOrder(order.number);
  const full = useQuery({...orderQuery(order.number), enabled: open}).data;
  const back = (full?.returns ?? []).filter(r => r.status === 'Refunded');
  const backAmount = back.reduce((n, r) => n + r.amount, 0);
  const backUnits = back.reduce((n, r) => n + r.itemCount, 0);
  const amount = Math.max(0, Math.round((order.total - backAmount) * 100) / 100);
  const units = Math.max(0, order.count - backUnits);
  const cur = order.currency;
  const card = full?.cardBrand ?? order.cardBrand ?? 'original';
  const [restock, setRestock] = useState(true);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setRestock(true);
    setNote('');
    setNoteError(null);
    refund.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const noteProblem = (v: string) => (v.trim().length > NOTE_MAX ? `Keep this under ${NOTE_MAX} characters` : null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const problem = noteProblem(note);
    setNoteError(problem);
    if (problem) {
      document.getElementById('refund-note')?.focus();
      return;
    }
    refund.mutate(
      {restock, note: note.trim() || undefined},
      {
        onSuccess: () => {
          toast.success(restock ? 'Order refunded · items returned to stock' : 'Order refunded');
          onClose();
        },
      }
    );
  };

  return (
    <ConfirmModal
      open={open}
      onClose={onClose}
      title={`Refund ${money(amount, cur)}`}
      description={
        backAmount > 0
          ? `${money(amount, cur)} is refunded to the ${card} card (${money(backAmount, cur)} was already refunded through returns) and ${order.number} is marked Refunded. The customer gets the refund email when it is switched on in Settings › Emails. This cannot be undone.`
          : `The full payment for ${order.number} is refunded to the ${card} card and the order is marked Refunded. The customer gets the refund email when it is switched on in Settings › Emails. This cannot be undone.`
      }
      confirmLabel="Refund order"
      pendingLabel="Refunding…"
      tone="danger"
      pending={refund.isPending}
      error={refund.error ? errorText(refund.error) : null}
      formId="refund-form">
      <form id="refund-form" className="form-stack" noValidate onSubmit={submit}>
        <Checkbox
          label="Return items to stock"
          description={`Adds ${pluralize(units, 'unit')} back to inventory${backUnits > 0 ? ' (returned units were restocked already)' : ''}.`}
          checked={restock}
          onChange={setRestock}
          disabled={refund.isPending}
        />
        <Field label="Note" id="refund-note" hint="Shown in the order timeline." error={noteError ?? undefined} optional>
          <textarea
            id="refund-note"
            rows={3}
            value={note}
            placeholder="Reason for the refund"
            aria-invalid={noteError ? true : undefined}
            aria-describedby={noteError ? 'refund-note-error' : 'refund-note-hint'}
            onChange={e => {
              setNote(e.target.value);
              if (noteError) setNoteError(noteProblem(e.target.value));
            }}
            onBlur={() => setNoteError(noteProblem(note))}
          />
        </Field>
      </form>
    </ConfirmModal>
  );
}
