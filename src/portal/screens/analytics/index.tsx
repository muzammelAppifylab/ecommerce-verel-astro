import {useQuery} from '@tanstack/react-query';
import {Link, useNavigate, useSearch} from '@tanstack/react-router';

import type {AdminAnalytics} from '../../../lib/types/admin/analytics';
import {pluralize} from '../../../lib/format';
import {analyticsQuery, reportSettingsQuery} from '../../queries';
import {
  Button,
  Card,
  type Column,
  CountUp,
  DataTable,
  DateRangeFilter,
  ErrorNote,
  formatMoneyAmount,
  Notice,
  PageHeader,
  PeriodToggle,
  SalesChart,
  Skeleton,
  Stat,
} from '../../ui';
import {axisAmount, moneyTween} from '../overview/Dashboard';
import {BarList, Empty, Funnel, InlineBar, pct, SearchTerm, share} from './parts';

/**
 * `/dashboard/analytics` (VAREL src/pages/admin/analytics/Analytics.tsx): storefront funnel, revenue and search
 * behaviour over a preset window or a custom range. Sessions and funnel steps come from visitor events;
 * purchases and revenue come from paid orders. The screen's CSS (./screen.css) is bundled by App.astro.
 */

const rangeText = (from: string, to: string) => {
  const f = new Date(`${from}T00:00:00`);
  const t = new Date(`${to}T00:00:00`);
  const same = f.getFullYear() === t.getFullYear();
  const short = (d: Date, y: boolean) => d.toLocaleDateString('en-GB', {day: 'numeric', month: 'short', ...(y ? {year: 'numeric'} : {})});
  return from === to ? short(f, true) : `${short(f, !same)} – ${short(t, true)}`;
};
const sinceText = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', {day: 'numeric', month: 'short', year: 'numeric'});
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', {day: 'numeric', month: 'short', year: 'numeric'});

/** How the range reads in running copy: "in the last 30 days", "since 4 Mar 2026", "in 1 Jan – 22 Oct 2026". */
const spanText = (d: AdminAnalytics, custom: boolean) =>
  d.lifetime ? `since ${sinceText(d.from)}` : custom ? `in ${rangeText(d.from, d.to)}` : `in the last ${d.days} days`;

export function Analytics() {
  const search = useSearch({from: '/analytics'});
  const navigate = useNavigate({from: '/analytics'});
  const {data, isLoading, isError, error, refetch, isFetching} = useQuery(analyticsQuery(search));
  const settings = useQuery(reportSettingsQuery).data;
  const custom = !!(search.from || search.to);
  const currency = settings?.currency ?? 'USD';

  return (
    <div className="app-page screen-analytics">
      <PageHeader
        title="Analytics"
        description={
          data
            ? `${data.lifetime ? 'All time · ' : ''}${rangeText(data.from, data.to)} · ${pluralize(data.days, 'day')}`
            : search.days === 'all'
              ? 'All time'
              : `Last ${search.days ?? 30} days`
        }
        actions={
          <>
            {isFetching && !isLoading && (
              <span className="analytics-updating" role="status">
                Updating…
              </span>
            )}
            <PeriodToggle
              value={custom ? undefined : (search.days ?? 30)}
              onChange={d => void navigate({search: d === 30 ? {} : {days: d}, replace: true, resetScroll: false})}
            />
            <DateRangeFilter
              from={search.from}
              to={search.to}
              label="Custom range"
              onChange={r => void navigate({search: {...(r.from ? {from: r.from} : {}), ...(r.to ? {to: r.to} : {})}, replace: true, resetScroll: false})}
            />
          </>
        }
      />

      {settings && !settings.analyticsEnabled && (
        <Notice tone="warning">
          Visitor analytics is off, so no new sessions, views or searches are recorded. Orders and revenue still update.{' '}
          <Link to="/settings/privacy">Turn it on in privacy settings</Link>
        </Notice>
      )}

      {isError && !data ? (
        <div className="analytics-error">
          <ErrorNote error={error} title="Analytics could not be loaded" />
          <Button variant="secondary" size="sm" pending={isFetching} pendingLabel="Trying again…" onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      ) : !data ? (
        <AnalyticsSkeleton />
      ) : (
        <AnalyticsBody data={data} custom={custom} currency={currency} />
      )}
    </div>
  );
}

function AnalyticsBody({data, custom, currency}: {data: AdminAnalytics; custom: boolean; currency: string}) {
  const t = data.totals;
  const span = spanText(data, custom);
  const money = (n: number) => formatMoneyAmount(n, currency);
  // The orders behind Revenue and Average order: paid, placed in this range.
  const paidOrders = {payment: ['Paid' as const], from: data.from, to: data.to};

  const viewCols: Column<AdminAnalytics['topProducts'][number]>[] = [
    {
      key: 'product',
      header: 'Product',
      cell: p => (
        <Link className="cell-title" to="/products/$id" params={{id: p.productId}}>
          {p.name}
        </Link>
      ),
    },
    {
      key: 'views',
      header: 'Views',
      align: 'end',
      cell: p => <InlineBar value={p.views} max={data.topProducts[0]!.views} label={`${p.views} views`} />,
    },
    {key: 'adds', header: 'Added to bag', align: 'end', width: 'shrink', cell: p => p.addToBag.toLocaleString('en-US')},
    {key: 'rate', header: 'Add rate', align: 'end', width: 'shrink', cell: p => pct(share(p.addToBag, p.views))},
  ];
  const searchCols: Column<AdminAnalytics['topSearches'][number]>[] = [
    {key: 'q', header: 'Search', cell: s => <SearchTerm query={s.query} />},
    {
      key: 'count',
      header: 'Searches',
      align: 'end',
      cell: s => <InlineBar value={s.count} max={data.topSearches[0]!.count} label={`${s.count} searches`} />,
    },
    {
      key: 'avg',
      header: 'Avg. results',
      align: 'end',
      width: 'shrink',
      cell: s =>
        s.avgResults === 0 ? <span className="analytics-none">None</span> : s.avgResults.toLocaleString('en-US', {maximumFractionDigits: 1}),
    },
  ];
  const emptyCols: Column<AdminAnalytics['noResultSearches'][number]>[] = [
    {key: 'q', header: 'Search', cell: s => <SearchTerm query={s.query} />},
    {key: 'count', header: 'Searches', align: 'end', width: 'shrink', cell: s => s.count.toLocaleString('en-US')},
    {key: 'last', header: 'Last searched', align: 'end', width: 'shrink', cell: s => shortDate(s.lastSearched)},
  ];

  return (
    <div className="analytics-body">
      <div className="stat-grid analytics-stats">
        <Stat
          label="Sessions"
          value={<CountUp value={t.sessions} format={n => Math.round(n).toLocaleString('en-US')} />}
          hint={`${t.pageViews.toLocaleString('en-US')} page views`}
        />
        <Stat
          label="Conversion rate"
          value={<CountUp value={t.conversionRate * 100} format={n => `${n.toFixed(2)}%`} />}
          hint={`${pluralize(t.orders, 'paid order')} from ${t.sessions.toLocaleString('en-US')} ${t.sessions === 1 ? 'session' : 'sessions'}`}
        />
        <Link className="analytics-stat-link" to="/orders" search={paidOrders} aria-label={`Revenue ${money(t.revenue)}, view the paid orders`}>
          <Stat label="Revenue" value={<CountUp value={t.revenue} format={moneyTween(t.revenue, currency)} />} hint="Paid orders, incl. shipping and tax" />
        </Link>
        <Link
          className="analytics-stat-link"
          to="/orders"
          search={paidOrders}
          aria-label={`Average order ${money(t.averageOrder)}, view the paid orders`}>
          <Stat
            label="Average order"
            value={<CountUp value={t.averageOrder} format={moneyTween(t.averageOrder, currency)} />}
            hint={`Across ${pluralize(t.orders, 'paid order')}`}
          />
        </Link>
      </div>

      <div className="analytics-row-wide">
        <Card title={`Revenue by ${data.bucket}`} description={`Paid orders by the ${data.bucket} they were placed`}>
          <SalesChart data={data.revenueByDay} bucket={data.bucket} caption={span} format={money} axisFormat={n => axisAmount(n, currency)} />
        </Card>
        <Card title="Funnel" description="Sessions reaching each step · purchases are paid orders">
          <Funnel steps={data.funnel} />
        </Card>
      </div>

      <div className="grid-2 analytics-row">
        <Card title="Sales by department" description="Merchandise after discounts">
          <BarList
            rows={data.revenueByDepartment.map(d => ({
              key: d.name,
              label: d.name,
              value: d.revenue,
              meta: pluralize(d.units, 'unit'),
              products: d.name === 'Unlisted' ? undefined : {dept: d.name},
            }))}
            format={money}
            empty="No paid orders in this range."
          />
        </Card>
        <Card title="Sales by category" description="Top 12 categories">
          <BarList
            rows={data.revenueByCategory.map(c => ({
              key: `${c.department}/${c.name}`,
              label: c.name,
              sub: c.department,
              value: c.revenue,
              meta: pluralize(c.units, 'unit'),
              products: c.department === 'Unlisted' ? undefined : {dept: c.department, category: c.name},
            }))}
            format={money}
            empty="No paid orders in this range."
          />
        </Card>
      </div>

      <Card title="Most viewed products" description="Product page views and adds to bag" flush>
        <DataTable
          caption="Most viewed products"
          columns={viewCols}
          rows={data.topProducts}
          rowKey={p => p.productId}
          empty={<Empty>No product views recorded in this range.</Empty>}
        />
      </Card>

      <div className="grid-2 analytics-row">
        <Card title="Top searches" flush>
          <DataTable
            caption="Top searches"
            columns={searchCols}
            rows={data.topSearches}
            rowKey={s => s.query}
            empty={<Empty>No searches recorded in this range.</Empty>}
          />
        </Card>
        <Card title="Searches with no results" description="Gaps in the catalogue or missing synonyms" flush>
          <DataTable
            caption="Searches with no results"
            columns={emptyCols}
            rows={data.noResultSearches}
            rowKey={s => s.query}
            empty={<Empty>Every search found something.</Empty>}
          />
        </Card>
      </div>
    </div>
  );
}

function AnalyticsSkeleton() {
  return (
    <div className="analytics-body" aria-busy="true" aria-label="Loading analytics">
      <div className="stat-grid analytics-stats">
        {['Sessions', 'Conversion rate', 'Revenue', 'Average order'].map(label => (
          <Stat key={label} label={label} value={null} hint={<Skeleton width="third" />} />
        ))}
      </div>
      <div className="analytics-row-wide">
        <Card title="Revenue">
          <Skeleton lines={7} />
        </Card>
        <Card title="Funnel">
          <Skeleton lines={7} />
        </Card>
      </div>
      <div className="grid-2 analytics-row">
        <Card title="Sales by department">
          <Skeleton lines={4} />
        </Card>
        <Card title="Sales by category">
          <Skeleton lines={4} />
        </Card>
      </div>
    </div>
  );
}
