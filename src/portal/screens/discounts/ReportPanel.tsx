import {useQuery} from '@tanstack/react-query';
import {Link} from '@tanstack/react-router';

import {money} from '../../../lib/format';
import type {AdminDiscountReport} from '../../../lib/types/admin/promotions';
import {discountReportQuery} from '../../queries/discounts';
import {Button, Card, type Column, DataTable, EmptyState, ErrorNote, SalesChart, Skeleton, Stat} from '../../ui';
import {formatDateTime} from './helpers';

type Redemption = AdminDiscountReport['recent'][number];

/** Per-discount performance: totals, 30-day revenue from orders that used it, recent redemptions. */
export function ReportPanel({id}: {id: string}) {
  const report = useQuery(discountReportQuery(id));

  if (report.error && !report.data)
    return (
      <div className="discount-load-error">
        <ErrorNote error={report.error} title="The report could not be loaded" />
        <Button variant="secondary" size="sm" icon="refresh" onClick={() => void report.refetch()}>
          Retry
        </Button>
      </div>
    );

  const r = report.data;
  const columns: Column<Redemption>[] = [
    {
      key: 'order',
      header: 'Order',
      width: 'shrink',
      cell: x => (
        <Link to="/orders/$number" params={{number: x.orderNumber}} className="num">
          {x.orderNumber}
        </Link>
      ),
    },
    {key: 'placed', header: 'Placed', width: 'shrink', cell: x => <span className="muted">{formatDateTime(x.placedAt)}</span>},
    {
      key: 'customer',
      header: 'Customer',
      cell: x => (
        <span className="cell-title">
          <span>{x.customer || x.email}</span>
          {x.customer && <span className="cell-sub">{x.email}</span>}
        </span>
      ),
    },
    {key: 'code', header: 'Code', cell: x => (x.code ? <span className="mono">{x.code}</span> : <span className="muted">Automatic</span>)},
    {key: 'amount', header: 'Discount', align: 'end', cell: x => money(x.amount)},
    {key: 'total', header: 'Order total', align: 'end', cell: x => money(x.orderTotal)},
  ];

  return (
    <div className="discount-report" data-testid="discount-report">
      <div className="stat-grid discount-stats">
        <Stat label="Uses" value={r ? r.uses.toLocaleString('en-US') : null} />
        <Stat label="Customers" value={r ? r.customers.toLocaleString('en-US') : null} />
        <Stat label="Discount given" value={r ? money(r.discountGiven) : null} />
        <Stat label="Revenue" value={r ? money(r.revenue) : null} hint="Totals of orders that used it" />
        <Stat label="Average order" value={r ? money(r.averageOrder) : null} />
      </div>

      <Card title="Last 30 days" description="Revenue from orders that used this discount, by day.">
        {r ? (
          r.byDay.length ? (
            <SalesChart data={r.byDay.map(d => ({date: d.date, total: d.revenue, orders: d.uses}))} format={n => money(n)} />
          ) : (
            <p className="muted discount-chart-empty">No activity in the last 30 days.</p>
          )
        ) : (
          <Skeleton lines={6} />
        )}
      </Card>

      <Card title="Recent redemptions" flush>
        <DataTable
          caption="Recent redemptions"
          columns={columns}
          rows={r?.recent}
          rowKey={x => `${x.orderNumber}-${x.code ?? ''}`}
          loading={report.isLoading}
          empty={<EmptyState icon="percent" title="Not used on any orders yet." />}
        />
      </Card>
    </div>
  );
}
