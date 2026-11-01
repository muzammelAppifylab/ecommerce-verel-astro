import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {createElement as h, type ReactNode} from 'react';
import {renderToString} from 'react-dom/server';
import {describe, expect, it, vi} from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  Link: ({children, to, params}: {children: ReactNode; to: string; params?: Record<string, string>}) =>
    h('a', {href: to.replace(/\$(\w+)/g, (_: string, k: string) => params?.[k] ?? '')}, children),
  useNavigate: () => () => undefined,
}));
vi.mock('../src/platform/browser', () => ({siteFetch: () => Promise.reject(new Error('no network in tests'))}));

import type {AbandonedBagRow} from '../src/lib/types/admin/merchandising';
import {meQuery} from '../src/portal/queries';
import {abandonedListQuery, DEFAULT_ABANDONED_FILTERS, type AbandonedPage} from '../src/portal/queries/abandoned';
import {AbandonedBags} from '../src/portal/screens/abandoned';
import {ConfirmProvider, ToastProvider} from '../src/portal/ui';

const row = (id: number, o: Partial<AbandonedBagRow> = {}): AbandonedBagRow => ({
  id: String(id),
  email: `shopper${id}@example.com`,
  customerName: id === 1 ? 'Ana Lee' : null,
  userId: id === 1 ? '7' : null,
  value: 123.5,
  itemCount: 2,
  items: [{name: 'Wool coat', meta: 'Stone · M', qty: 2, total: 123.5, image: {src: 'https://images.example/coat.jpg', credit: '', creditHref: ''}, productId: 'wool-coat'}],
  createdAt: '2026-10-30T10:00:00.000Z',
  lastActivity: '2026-10-31T10:00:00.000Z',
  reminderSentAt: null,
  dismissedAt: null,
  status: 'abandoned',
  ...o,
});

function render(page: AbandonedPage | null) {
  const qc = new QueryClient({defaultOptions: {queries: {retry: false, staleTime: Infinity}}});
  qc.setQueryData(meQuery.queryKey, {abilities: {manageOrders: true, manageStoreSettings: true}} as never);
  if (page) qc.setQueryData(abandonedListQuery(DEFAULT_ABANDONED_FILTERS).queryKey, {pages: [page], pageParams: [undefined]});
  return renderToString(h(QueryClientProvider, {client: qc}, h(ToastProvider, null, h(ConfirmProvider, null, h(AbandonedBags)))));
}

const summary = (n: number): AbandonedPage['summary'] => ({
  active: {count: 0, value: 0},
  abandoned: {count: n, value: 123.5 * n},
  reminded: {count: 1, value: 10},
  superseded: {count: 0, value: 0},
  dismissed: {count: 0, value: 0},
  ordered: {count: 0, value: 0},
  recovered: {orders: 2, revenue: 300},
});

/** The abandoned-bags screen renders its states from seeded query data (server render, no browser). */
describe('AbandonedBags screen', () => {
  it('renders rows, tiles, settings and filters', () => {
    const html = render({
      items: [row(1), row(2, {status: 'reminded', reminderSentAt: '2026-10-31T11:00:00.000Z'})],
      nextCursor: 'abc',
      settings: {enabled: true, hours: 24},
      summary: summary(1),
      capped: true,
    });
    expect(html).toContain('Abandoned bags');
    expect(html).toContain('shopper1@example.com');
    expect(html).toContain('Ana Lee');
    expect(html).toContain('Guest');
    expect(html).toContain('Due a reminder');
    expect(html).toContain('Reminder sent');
    expect(html).toContain('Send due reminders<!-- --> (1)');
    expect(html).toContain('Recovered · 30 days');
    expect(html).toContain('2 orders within 7 days of a reminder');
    expect(html).toContain('After 24 hours');
    expect(html).toContain('Checked every 15 minutes. One reminder per shopper.');
    expect(html).toContain('Showing the 500 most recently active bags.');
    expect(html).toContain('Load more');
    expect(html).toContain('Search by email or product');
  });

  it('renders the empty state', () => {
    const html = render({items: [], nextCursor: null, settings: {enabled: false, hours: 36}, summary: summary(0)});
    expect(html).toContain('No abandoned bags.');
    expect(html).toContain('Off. No reminders are sent until you turn this on.');
    expect(html).toContain('Turn on reminder emails first');
    expect(html).toContain('After 36 hours');
  });

  it('renders the loading state', () => {
    const html = render(null);
    expect(html).toContain('skeleton');
  });
});
