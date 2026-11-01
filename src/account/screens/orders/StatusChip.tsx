import type {Order} from '@/lib/types/orders';
import {cn} from '@/lib/utils';

import {useOrdersT} from './host';
import {statusTextClass} from './order-utils';

/** Fulfilment status as a readable chip: tinted dot + sentence-case label (colour never carries it alone). */
export function StatusChip({status, className}: {status: Order['fulfillment']; className?: string}) {
  const t = useOrdersT('orders');
  return (
    <span className={cn('inline-flex items-center gap-2 text-[13.5px] whitespace-nowrap', statusTextClass(status), className)}>
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
      {t(`fulfillment.${status.toLowerCase()}`, {defaultValue: status})}
    </span>
  );
}
