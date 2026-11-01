import {Link} from '@tanstack/react-router';
import type {ReactNode} from 'react';

import type {AdminDashboard} from '../../../lib/types/admin/analytics';
import type {AdminOrderRow} from '../../../lib/types/admin/sales';
import {photoUrl} from '../../../lib/format';
import {
  buttonClass,
  Card,
  type Column,
  CountUp,
  DataTable,
  formatMoneyAmount,
  Icon,
  type IconName,
  ProgressBar,
  SalesChart,
  Skeleton,
  Stat,
  StatusBadge,
  type Tone,
} from '../../ui';

/**
 * The dashboard's body (VAREL src/pages/admin/dashboard/Dashboard.tsx `DashboardBody`): KPI tiles, what needs
 * attention, sales, top products, recent orders and low stock, for the chosen window. Components swapped for
 * the portal kit (PLAN.md §6); bars are `ProgressBar` (no inline style under the CSP).
 */

/** Counts the server caps (src/server/routes/admin/dashboard.ts `COUNT_CAP`, `CUSTOMER_CAP`). */
const COUNT_CAP = 1000;
const CUSTOMER_CAP = 10_000;

export const PAYMENT_TONES: Record<string, Tone> = {Paid: 'success', Pending: 'warning', Refunded: 'neutral', Failed: 'danger'};
export const FULFILMENT_TONES: Record<string, Tone> = {
  Unfulfilled: 'warning',
  Processing: 'warning',
  Shipped: 'info',
  Delivered: 'success',
  Returned: 'neutral',
  Cancelled: 'danger',
};

export const longDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', {day: 'numeric', month: 'short', year: 'numeric'});
export const todayText = () => new Date().toLocaleDateString('en-GB', {weekday: 'long', day: 'numeric', month: 'long'});
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', {day: 'numeric', month: 'short', year: 'numeric'});

/** "last 30 days" / "all time": the window in running copy. */
const windowText = (d: Pick<AdminDashboard, 'lifetime' | 'periodDays'>) => (d.lifetime ? 'all time' : `last ${d.periodDays} days`);

/** A capped count as "1,000+". */
const capped = (n: number, cap: number) => (n >= cap ? `${cap.toLocaleString('en-US')}+` : n.toLocaleString('en-US'));

/** Money for a tweening value: whole targets stay whole while counting, so the width never jitters. */
export const moneyTween = (target: number, currency: string) => (n: number) =>
  formatMoneyAmount(Number.isInteger(target) ? Math.round(n) : Math.round(n * 100) / 100, currency);

/** VAREL `Change`: the trend chip against the previous window, or why there is none. */
function change(cur: number, prev: number, days: number): {trend?: {label: string; direction: 'up' | 'down'}; hint: string} {
  if (!prev) return {hint: `No sales in the previous ${days} days`};
  const pct = ((cur - prev) / prev) * 100;
  const up = pct >= 0;
  return {trend: {label: `${up ? '+' : '−'}${Math.abs(pct).toFixed(1)}%`, direction: up ? 'up' : 'down'}, hint: `vs previous ${days} days`};
}

export function DashboardBody({d, currency}: {d: AdminDashboard; currency: string}) {
  const days = d.periodDays ?? 30;
  const span = windowText(d);
  const money = (n: number) => formatMoneyAmount(n, currency);
  const maxUnits = Math.max(1, ...d.topProducts.map(p => p.units));
  const since = `Since the first order, ${longDate(d.since)}`;
  const revenueChange = change(d.revenue30d, d.revenuePrev30d, days);
  const ordersChange = change(d.orders30d, d.ordersPrev30d, days);

  const orderCols: Column<AdminOrderRow>[] = [
    {
      key: 'number',
      header: 'Order',
      width: 'shrink',
      cell: o => (
        <Link className="cell-title" to="/orders/$number" params={{number: o.number}}>
          {o.number}
        </Link>
      ),
    },
    {key: 'date', header: 'Placed', width: 'shrink', hideOnMobile: true, cell: o => <span className="muted">{shortDate(o.placedAt)}</span>},
    {
      key: 'customer',
      header: 'Customer',
      cell: o => (
        <span className="overview-truncate" title={o.email}>
          {o.customerName}
        </span>
      ),
    },
    {key: 'payment', header: 'Payment', width: 'shrink', cell: o => <StatusBadge tone={PAYMENT_TONES[o.payment] ?? 'neutral'}>{o.payment}</StatusBadge>},
    {
      key: 'fulfillment',
      header: 'Fulfilment',
      width: 'shrink',
      cell: o => <StatusBadge tone={FULFILMENT_TONES[o.fulfillment] ?? 'neutral'}>{o.fulfillment}</StatusBadge>,
    },
    {key: 'total', header: 'Total', align: 'end', width: 'shrink', cell: o => formatMoneyAmount(o.total, o.currency ?? currency)},
  ];

  return (
    <div className="overview-body">
      <div className="stat-grid overview-kpis">
        <Stat
          label="Revenue"
          value={<CountUp value={d.revenue30d} format={moneyTween(d.revenue30d, currency)} />}
          trend={d.lifetime ? undefined : revenueChange.trend}
          hint={d.lifetime ? since : revenueChange.hint}
        />
        <Stat
          label="Orders"
          value={<CountUp value={d.orders30d} format={n => Math.round(n).toLocaleString('en-US')} />}
          trend={d.lifetime ? undefined : ordersChange.trend}
          hint={d.lifetime ? since : ordersChange.hint}
        />
        <Stat
          label="Average order"
          value={<CountUp value={d.averageOrder30d} format={moneyTween(d.averageOrder30d, currency)} />}
          hint={`Revenue ÷ paid orders, ${span}`}
        />
        <Stat
          label="Customers"
          value={
            d.customers >= CUSTOMER_CAP ? capped(d.customers, CUSTOMER_CAP) : <CountUp value={d.customers} format={n => Math.round(n).toLocaleString('en-US')} />
          }
          hint={d.lifetime ? 'Customer accounts, all time' : `+${capped(d.newCustomers30d, CUSTOMER_CAP)} new in the last ${days} days`}
        />
      </div>

      <div className="overview-attention">
        <Attention
          icon="package"
          count={d.openOrders}
          label="Open orders"
          hint="Unfulfilled or processing"
          link={children => (
            <Link
              className="attention-link"
              to="/orders"
              search={{fulfillment: ['Unfulfilled', 'Processing']}}
              aria-label={`${capped(d.openOrders, COUNT_CAP)} open orders`}>
              {children}
            </Link>
          )}
        />
        <Attention
          icon="rotate-ccw"
          count={d.pendingReturns}
          label="Pending returns"
          hint="To review, receive or refund"
          link={children => (
            <Link
              className="attention-link"
              to="/returns"
              search={{status: ['Requested', 'Approved', 'Received']}}
              aria-label={`${capped(d.pendingReturns, COUNT_CAP)} pending returns`}>
              {children}
            </Link>
          )}
        />
      </div>

      <div className="grid-main-side overview-row">
        <Card title="Sales" description={`Revenue per ${d.salesBucket ?? 'day'}, ${span}`}>
          {d.salesByDay.length ? (
            <SalesChart
              data={d.salesByDay}
              bucket={d.salesBucket}
              caption={d.lifetime ? `since ${longDate(d.since)}` : undefined}
              format={money}
              axisFormat={n => axisAmount(n, currency)}
            />
          ) : (
            <p className="overview-empty">No sales data yet.</p>
          )}
        </Card>

        <Card title="Top products" description={`By units sold, ${span}`} flush>
          {d.topProducts.length ? (
            <ol className="rank-list">
              {d.topProducts.map((p, i) => (
                <li key={p.productId} className="rank-row">
                  <div className="rank-head">
                    <span className="rank-index">{i + 1}</span>
                    <Link className="rank-name" to="/products/$id" params={{id: p.productId}}>
                      {p.name}
                    </Link>
                    <span className="rank-value">
                      <CountUp value={p.revenue} format={moneyTween(p.revenue, currency)} />
                    </span>
                  </div>
                  <div className="rank-bar">
                    <ProgressBar value={p.units} max={maxUnits} label={`${p.units} sold`} />
                    <span className="rank-meta">{p.units} sold</span>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="overview-empty">{d.lifetime ? 'No sales yet.' : `No sales in the last ${days} days.`}</p>
          )}
        </Card>
      </div>

      <div className="grid-main-side overview-row">
        <Card
          title="Recent orders"
          flush
          actions={
            <Link className={buttonClass({variant: 'ghost', size: 'sm'})} to="/orders">
              All orders
              <Icon name="arrow-right" size={14} />
            </Link>
          }>
          <DataTable
            caption="Recent orders"
            columns={orderCols}
            rows={d.recentOrders}
            rowKey={o => o.number}
            empty={<p className="overview-empty">No orders yet.</p>}
          />
        </Card>

        <Card
          title="Low stock"
          description={d.lowStock.length ? `${d.lowStock.length} ${d.lowStock.length === 1 ? 'variant' : 'variants'} to restock` : undefined}
          flush
          actions={
            <Link className={buttonClass({variant: 'ghost', size: 'sm'})} to="/inventory" search={{state: ['low', 'out']}}>
              Inventory
              <Icon name="arrow-right" size={14} />
            </Link>
          }>
          {d.lowStock.length ? (
            <ul className="stock-list">
              {d.lowStock.map(r => (
                <li key={r.variantId} className="stock-row">
                  <span className="stock-thumb">{r.image && <img src={photoUrl(r.image, 80)} alt="" loading="lazy" width={33} height={44} />}</span>
                  <span className="stock-text">
                    <Link className="stock-name" to="/products/$id" params={{id: r.productId}}>
                      {r.productName}
                    </Link>
                    <span className="stock-sub">
                      {[r.color, r.size, ...Object.values(r.options ?? {})].filter(Boolean).join(' · ') || r.variantId}
                    </span>
                  </span>
                  <span className={r.inventory === 0 ? 'stock-qty is-out' : 'stock-qty'}>{r.inventory}</span>
                  <StatusBadge tone={r.state === 'out' ? 'danger' : 'warning'}>{r.state === 'out' ? 'Out' : 'Low'}</StatusBadge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="overview-empty">Everything is well stocked.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

/** Short axis money in the store currency: "$0", "$500", "$2.5k" (kit `axisMoney` is USD only). */
export function axisAmount(v: number, currency: string): string {
  const symbol =
    new Intl.NumberFormat('en-US', {style: 'currency', currency, maximumFractionDigits: 0})
      .formatToParts(0)
      .find(p => p.type === 'currency')?.value ?? '';
  return v >= 1000 ? `${symbol}${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k` : `${symbol}${v}`;
}

/** VAREL `Attention`: an icon tile, the count, a link over the whole card ("hot" when above zero). */
function Attention({
  icon,
  count,
  label,
  hint,
  link,
}: {
  icon: IconName;
  count: number;
  label: string;
  hint: string;
  link: (children: ReactNode) => ReactNode;
}) {
  const hot = count > 0;
  return link(
    <span className={hot ? 'attention is-hot' : 'attention'}>
      <span className="attention-icon">
        <Icon name={icon} size={18} />
      </span>
      <span className="attention-text">
        <span className="attention-label">{label}</span>
        <span className="attention-hint">{hint}</span>
      </span>
      <span className="attention-count">{count >= COUNT_CAP ? capped(count, COUNT_CAP) : <CountUp value={count} />}</span>
      <Icon name="arrow-right" size={16} className="attention-arrow" />
    </span>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="overview-body" aria-busy="true" aria-label="Loading dashboard">
      <div className="stat-grid overview-kpis">
        {['Revenue', 'Orders', 'Average order', 'Customers'].map(label => (
          <Stat key={label} label={label} value={null} hint={<Skeleton width="third" />} />
        ))}
      </div>
      <div className="overview-attention">
        <div className="attention">
          <Skeleton />
        </div>
        <div className="attention">
          <Skeleton />
        </div>
      </div>
      <div className="grid-main-side overview-row">
        <Card title="Sales">
          <div className="overview-skeleton-block">
            <Skeleton lines={6} />
          </div>
        </Card>
        <Card title="Top products">
          <Skeleton lines={6} />
        </Card>
      </div>
    </div>
  );
}
