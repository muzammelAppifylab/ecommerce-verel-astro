import type {ReactNode} from 'react';

import {money, pluralize} from '../../../lib/format';
import type {AbandonedList, AbandonedStatus} from '../../../lib/types/admin/merchandising';
import {Skeleton, Stat} from '../../ui';
import type {AbandonedFilter} from '../../queries/abandoned';

/** The funnel at a glance (VAREL `SummaryCard`s); the first three tiles filter the table. */
export function SummaryTiles({
  summary,
  status,
  onFilter,
}: {
  summary: AbandonedList['summary'] | undefined;
  status: AbandonedFilter;
  onFilter: (status: AbandonedStatus) => void;
}) {
  const tile = (s: 'active' | 'abandoned' | 'reminded', label: string, hint: (v: string) => string) => (
    <FilterTile
      label={label}
      value={summary ? String(summary[s].count) : null}
      hint={summary ? hint(money(summary[s].value)) : ''}
      active={status === s}
      onClick={() => onFilter(s)}
    />
  );
  return (
    <div className="stat-grid ab-tiles">
      {tile('active', 'Still shopping', v => `${v} in bags`)}
      {tile('abandoned', 'Due a reminder', v => `${v} at stake`)}
      {tile('reminded', 'Reminded', v => `${v} waiting`)}
      <Stat
        label="Recovered · 30 days"
        value={summary ? money(summary.recovered.revenue) : null}
        hint={summary ? `${pluralize(summary.recovered.orders, 'order')} within 7 days of a reminder` : undefined}
      />
    </div>
  );
}

/** A `Stat` that doubles as a filter button (same markup as the kit's tile). */
function FilterTile({label, value, hint, active, onClick}: {label: string; value: string | null; hint: ReactNode; active: boolean; onClick: () => void}) {
  return (
    <button type="button" className="stat stat-link ab-tile" aria-pressed={active} data-active={active ? '' : undefined} onClick={onClick}>
      <span className="stat-top">
        <span className="stat-label">{label}</span>
      </span>
      <span className="stat-value">{value ?? <Skeleton width="half" />}</span>
      <span className="stat-hint">{hint || ' '}</span>
    </button>
  );
}
