import type {Tone} from '../../ui';
import type {CustomerRole} from '../../queries';

/** One tone per status, used everywhere that status shows on these screens (VAREL `StatusChip`). */
export const ROLE_TONES: Record<CustomerRole, Tone> = {customer: 'neutral', staff: 'info', admin: 'brand'};

export const PAYMENT_TONES: Record<string, Tone> = {Paid: 'success', Pending: 'warning', Refunded: 'neutral', Failed: 'danger'};

export const FULFILMENT_TONES: Record<string, Tone> = {
  Unfulfilled: 'warning',
  Processing: 'info',
  Shipped: 'info',
  Delivered: 'success',
  Returned: 'neutral',
  Cancelled: 'neutral',
};
