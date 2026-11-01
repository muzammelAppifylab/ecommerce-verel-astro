import {useState} from 'react';

import {notify, Select} from '@/components/varel';
import {money} from '@/lib/format';
import {errorMessage} from '@/lib/storefront-api';
import type {CancelReason, Order} from '@/lib/types/orders';

import {useOrdersLocale, useOrdersT} from './host';
import {ConfirmDialog} from './parts';
import {useCancelOrder} from './queries';

export const CANCEL_REASONS: CancelReason[] = ['changed_mind', 'ordered_by_mistake', 'wrong_size', 'too_slow', 'other'];

/** Confirm a cancellation, with an optional reason for the studio (VAREL OrderDetails CancelDialog). */
export function CancelDialog({order: o, open, onClose}: {order: Order; open: boolean; onClose: () => void}) {
  const t = useOrdersT('orders');
  const locale = useOrdersLocale();
  const cancel = useCancelOrder(o.number);
  const [reason, setReason] = useState<CancelReason | ''>('');
  const amount = money(o.total, o.currency, locale);
  const card = o.cardLast4
    ? o.cardBrand
      ? t('details.brandEnding', {brand: o.cardBrand, last4: o.cardLast4})
      : t('details.ending', {last4: o.cardLast4})
    : null;
  return (
    <ConfirmDialog
      open={open}
      title={t('cancel.title', {number: o.number})}
      confirmLabel={t('cancel.confirm')}
      cancelLabel={t('cancel.keep')}
      pendingLabel={t('cancel.pending')}
      pending={cancel.isPending}
      error={cancel.error ? errorMessage(cancel.error) : null}
      destructive
      onClose={() => {
        cancel.reset();
        setReason('');
        onClose();
      }}
      onConfirm={() =>
        cancel.mutate(reason || undefined, {
          onSuccess: () => {
            onClose();
            notify(t('cancel.done'));
          },
        })
      }>
      <p className="m-0">
        {o.payment === 'Paid'
          ? card
            ? t('cancel.bodyCard', {amount, card})
            : t('cancel.body', {amount})
          : t('cancel.bodyUnpaid')}
      </p>
      <Select
        label={t('cancel.reasonLabel')}
        value={reason}
        disabled={cancel.isPending}
        onValueChange={v => setReason(v as CancelReason | '')}
        options={[{value: '', label: t('cancel.reasonNone')}, ...CANCEL_REASONS.map(r => ({value: r, label: t(`cancel.reasons.${r}`)}))]}
      />
    </ConfirmDialog>
  );
}
