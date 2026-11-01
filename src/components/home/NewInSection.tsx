/* "New in · The season, edited" (port of VAREL src/pages/home/NewInSection.tsx): filter row, sort select and the
   4-up product grid. An island (`client:visible`): the first page (`all`, `featured`) is read on the server and
   passed as `initial`; other filters and sorts are read in the browser (src/components/home/fetch.ts), keeping
   the previous grid dimmed while the next one loads (VAREL `keepPreviousData`). Filter and sort are not in the
   URL (VAREL). */
import {useEffect, useMemo, useState} from 'react';

import {Button, ProductTileSkeleton} from '@/components/varel';
import {useText} from '@/components/varel/text';
import type {ProductListResponse, ProductSort} from '@/lib/types/catalog';
import {cn} from '@/lib/utils';

import {createProductLoader, isAbort} from './fetch';
import {HomeProductCard} from './HomeProductCard';
import {type HomeProps, HomeText} from './island';
import {FILTERS, type FilterKey, queryFor, SORTS} from './sections';

type Status = 'idle' | 'pending' | 'error';

function NewIn({initial, currency}: {initial: ProductListResponse | null; currency?: string}) {
  const t = useText('home');
  const loader = useMemo(() => {
    const l = createProductLoader();
    if (initial) l.seed(queryFor('all', 'featured'), initial);
    return l;
  }, [initial]);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [sort, setSort] = useState<ProductSort>('featured');
  const [data, setData] = useState<ProductListResponse | null>(initial);
  const [status, setStatus] = useState<Status>(initial ? 'idle' : 'pending');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const q = queryFor(filter, sort);
    const hit = attempt === 0 ? loader.peek(q) : undefined;
    if (hit) {
      setData(hit);
      setStatus('idle');
      return;
    }
    let live = true;
    setStatus('pending');
    loader
      .load(q, {fresh: attempt > 0})
      .then(next => {
        if (!live) return;
        setData(next);
        setStatus('idle');
      })
      .catch((e: unknown) => {
        if (!live || isAbort(e)) return;
        setStatus('error');
      });
    return () => {
      live = false;
    };
  }, [filter, sort, attempt, loader]);

  useEffect(() => () => loader.abort(), [loader]);

  const items = data?.items ?? [];
  const pending = status === 'pending';

  return (
    <section id="shop" className="px-6 pt-16 md:px-12 md:pt-24">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-8">
        <div className="flex flex-col gap-2.5">
          <span className="text-label-md tracking-loose text-text-secondary uppercase">{t('newIn.eyebrow')}</span>
          <h2 className="m-0 font-display text-[36px] leading-tight font-normal tracking-display md:text-display-3">
            {t('newIn.title')}
          </h2>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-label-sm tracking-label text-text-muted uppercase" aria-live="polite">
            {data ? t('pieces', {count: data.total}) : ' '}
          </span>
          <select
            value={sort}
            onChange={e => setSort(e.target.value as ProductSort)}
            aria-label={t('newIn.sortLabel')}
            className="h-10 rounded-none border-0 border-b border-strong bg-transparent pr-2 font-sans text-label-sm tracking-label text-text-primary uppercase">
            {SORTS.map(v => (
              <option key={v} value={v}>
                {t(`newIn.sort.${v}`)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div
        role="group"
        aria-label={t('newIn.filterLabel')}
        className="mb-10 flex flex-wrap gap-x-7 gap-y-2 border-y border-hairline py-4">
        {FILTERS.map(key => {
          const on = filter === key;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={on}
              onClick={() => {
                setAttempt(0);
                setFilter(key);
              }}
              className={cn(
                'rounded-none border-0 border-b-2 bg-transparent px-0 py-1 font-sans text-label-sm tracking-label uppercase transition-hover',
                on ? 'border-ink-900 text-text-primary' : 'border-transparent text-text-muted hover:text-text-primary'
              )}>
              {t(`newIn.filters.${key}`)}
            </button>
          );
        })}
      </div>

      {status === 'error' ? (
        <div className="flex flex-col items-start gap-4 border-y border-hairline py-12">
          <p className="m-0 text-[15px] text-text-secondary">{t('newIn.error')}</p>
          <Button variant="outline" size="sm" onClick={() => setAttempt(a => a + 1)}>
            {t('newIn.tryAgain')}
          </Button>
        </div>
      ) : pending && !data ? (
        <div className="grid grid-cols-2 gap-x-3 gap-y-10 sm:gap-x-5 lg:grid-cols-4 lg:gap-y-12">
          {Array.from({length: 8}, (_, i) => (
            <ProductTileSkeleton key={i} />
          ))}
        </div>
      ) : items.length === 0 && !pending ? (
        <p className="m-0 border-y border-hairline py-12 text-[15px] text-text-secondary">{t('newIn.empty')}</p>
      ) : (
        <div
          aria-busy={pending || undefined}
          className={cn(
            'grid grid-cols-2 gap-x-3 gap-y-10 transition-opacity sm:gap-x-5 lg:grid-cols-4 lg:gap-y-12',
            pending && 'opacity-60'
          )}>
          {items.map(p => (
            <HomeProductCard key={p.id} product={p} currency={currency} />
          ))}
        </div>
      )}
    </section>
  );
}

export function NewInSection({initial, ...props}: HomeProps & {initial: ProductListResponse | null}) {
  return (
    <HomeText {...props}>
      <NewIn initial={initial} currency={props.currency} />
    </HomeText>
  );
}
