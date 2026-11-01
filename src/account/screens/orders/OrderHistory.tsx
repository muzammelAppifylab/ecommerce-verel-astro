/* Order history (VAREL src/pages/OrderHistory.tsx): filters, one card per order, "Show more orders" (keyset pages).
   Route `/orders/` of the account app (WP-13 registers it; `?status=open|completed|returned`). */
import {useInfiniteQuery, useQueryClient} from '@tanstack/react-query';
import {useNavigate, useSearch} from '@tanstack/react-router';

import {Button, buttonClasses, EmptyState, Skeleton} from '@/components/varel';
import {shopLink} from '@/lib/links';
import {errorMessage} from '@/lib/storefront-api';
import type {AccountOverview} from '@/lib/types/account';
import type {OrderStatusFilter} from '@/lib/types/orders';
import {cn} from '@/lib/utils';

import {useOrdersLocale, useOrdersT, useOrdersTitle} from './host';
import {OrderCard} from './OrderCard';
import {AccountHeader} from './parts';
import {ordersInfiniteQuery} from './queries';

type FilterKey = 'all' | OrderStatusFilter;
const FILTERS: FilterKey[] = ['all', 'open', 'completed', 'returned'];

/** `?status=` as the router gives it: only the three filters, anything else is "all". */
export function statusOf(search: unknown): OrderStatusFilter | undefined {
  const s = (search as {status?: unknown} | null)?.status;
  return s === 'open' || s === 'completed' || s === 'returned' ? s : undefined;
}

export default function OrderHistory() {
  const t = useOrdersT('orders');
  const locale = useOrdersLocale();
  useOrdersTitle(t('history.title'));
  const status = statusOf(useSearch({strict: false}));
  const filter: FilterKey = status ?? 'all';
  const navigate = useNavigate();
  const qc = useQueryClient();

  const all = useInfiniteQuery(ordersInfiniteQuery());
  const view = useInfiniteQuery(ordersInfiniteQuery(status));

  const select = (k: FilterKey) => {
    void navigate({
      to: '.',
      search: (prev: Record<string, unknown>) => ({...prev, status: k === 'all' ? undefined : k}),
      replace: true,
    } as never);
  };

  // No total query (AGENTS.md): the count is what the first page holds, "20+" while more pages exist.
  const first = all.data?.pages[0];
  const since = qc.getQueryData<AccountOverview>(['account', 'overview'])?.user?.since;
  const count = first?.items.length;
  const more = !!first?.nextCursor;
  const countLine =
    count == null
      ? ''
      : since
        ? t(more ? 'history.countSinceMore' : 'history.countSince', {count, since})
        : t(more ? 'history.countMore' : 'history.count', {count});

  const orders = view.data?.pages.flatMap(p => p.items) ?? [];

  return (
    <div className="flex flex-col">
      <AccountHeader
        title={t('history.heading')}
        description={<span className="block min-h-[1.62em]">{countLine}</span>}
        actions={
          <div role="group" aria-label={t('history.filters.label')} className="flex flex-wrap gap-2">
            {FILTERS.map(k => {
              const on = filter === k;
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={on}
                  onClick={() => select(k)}
                  className={cn(
                    'h-9 border px-4 text-[14px] transition-hover',
                    on
                      ? 'border-ink-900 bg-ink-900 text-ink-000'
                      : 'border-hairline bg-transparent text-text-primary hover:border-strong'
                  )}>
                  {t(`history.filters.${k}`)}
                </button>
              );
            })}
          </div>
        }
      />

      <div className="flex flex-col gap-5">
        {view.isPending ? (
          <div aria-busy="true" className="flex flex-col gap-5">
            {Array.from({length: 3}, (_, i) => (
              <Skeleton key={i} className="h-56" />
            ))}
          </div>
        ) : view.isError && !orders.length ? (
          <EmptyState
            title={t('history.loadError')}
            description={errorMessage(view.error)}
            action={
              <Button variant="outline" onClick={() => void view.refetch()} loading={view.isFetching} loadingLabel={t('tryAgain')}>
                {t('tryAgain')}
              </Button>
            }
          />
        ) : !orders.length ? (
          <EmptyState
            title={t('history.empty.title')}
            description={t('history.empty.description')}
            action={
              <a href={shopLink(locale)} className={buttonClasses({variant: 'outline', className: 'h-auto px-6 py-3.5 text-label-sm'})}>
                {t('allProducts')}
              </a>
            }
          />
        ) : (
          <>
            {orders.map(o => (
              <OrderCard key={o.number} order={o} />
            ))}
            {view.hasNextPage && (
              <div className="flex flex-col items-center gap-3 pt-3">
                <Button
                  variant="outline"
                  onClick={() => void view.fetchNextPage()}
                  loading={view.isFetchingNextPage}
                  loadingLabel={t('history.loadingMore')}>
                  {t('history.more')}
                </Button>
                {view.isFetchNextPageError && (
                  <span role="alert" className="text-body-xs text-signal-critical">
                    {errorMessage(view.error)}
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
