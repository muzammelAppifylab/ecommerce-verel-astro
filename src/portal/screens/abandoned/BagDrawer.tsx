import {Link} from '@tanstack/react-router';

import {money} from '../../../lib/format';
import type {AbandonedBagRow} from '../../../lib/types/admin/merchandising';
import {Button, DefinitionList, Drawer, StatusBadge} from '../../ui';
import {customerOf, formatDateTime, STATUS_HINT, STATUS_LABEL, STATUS_TONES} from './format';

/** Side drawer: the bag's pieces, its history and the actions (VAREL `BagSheet`). */
export function BagDrawer({
  bag,
  onClose,
  sending,
  busy,
  dismissing,
  onRemind,
  onDismiss,
}: {
  bag: AbandonedBagRow | null;
  onClose: () => void;
  /** This bag's reminder is being sent. */
  sending: boolean;
  /** Another bag's reminder is being sent. */
  busy: boolean;
  dismissing: boolean;
  onRemind: (r: AbandonedBagRow) => void;
  onDismiss: (r: AbandonedBagRow) => void;
}) {
  return (
    <Drawer
      open={!!bag}
      onClose={onClose}
      title={bag?.email ?? ''}
      description={
        bag && (
          <span className="ab-drawer-sub">
            <StatusBadge tone={STATUS_TONES[bag.status]}>{STATUS_LABEL[bag.status]}</StatusBadge>
            <span>{customerOf(bag)}</span>
          </span>
        )
      }
      footer={
        bag && (
          <div className="ab-drawer-foot">
            <Button icon="mail" pending={sending} pendingLabel="Sending…" disabled={busy || dismissing} onClick={() => onRemind(bag)}>
              {bag.reminderSentAt ? 'Send another reminder' : 'Send reminder now'}
            </Button>
            <Button
              variant="secondary"
              pending={dismissing}
              pendingLabel={bag.status === 'dismissed' ? 'Restoring…' : 'Dismissing…'}
              disabled={sending}
              onClick={() => onDismiss(bag)}>
              {bag.status === 'dismissed' ? 'Restore' : 'Dismiss'}
            </Button>
            {bag.userId && (
              <Link className="ab-drawer-link" to="/customers/$id" params={{id: bag.userId}}>
                View customer
              </Link>
            )}
          </div>
        )
      }>
      {bag && (
        <>
          <p className="ab-muted">{STATUS_HINT[bag.status]}</p>
          <ul className="ab-lines">
            {bag.items.map((i, n) => (
              <li key={n} className="ab-line">
                <img className="ab-thumb ab-thumb-lg" src={i.image.src} alt="" width={40} height={53} loading="lazy" />
                <div className="ab-line-text">
                  <Link className="ab-line-name" to="/products/$id" params={{id: i.productId}}>
                    {i.name}
                  </Link>
                  <p className="ab-muted">{[i.meta, `Qty ${i.qty}`].filter(Boolean).join(' · ')}</p>
                </div>
                <span className="ab-num">{money(i.total)}</span>
              </li>
            ))}
          </ul>
          <p className="ab-total">
            <span>Bag value</span>
            <span className="ab-num">{money(bag.value)}</span>
          </p>
          <DefinitionList
            items={[
              {label: 'Started', value: formatDateTime(bag.createdAt)},
              {label: 'Last activity', value: formatDateTime(bag.lastActivity)},
              {label: 'Reminder', value: bag.reminderSentAt ? `Sent ${formatDateTime(bag.reminderSentAt)}` : 'Not sent'},
              ...(bag.dismissedAt && bag.status === 'dismissed' ? [{label: 'Dismissed', value: formatDateTime(bag.dismissedAt)}] : []),
            ]}
          />
        </>
      )}
    </Drawer>
  );
}
