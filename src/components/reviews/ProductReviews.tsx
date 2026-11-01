/* PDP reviews (VAREL src/pages/product/ProductReviews.tsx): summary (average, distribution), the list with
   sort and pages, and the write-a-review form. An island (`client:visible`, ReviewsSection.astro): the first
   page arrives server-rendered as `initial`; later pages, sorts and the visitor's eligibility load in the
   browser (plain calls, no query library: public JS budget). Strings come in `dict` (namespace `reviews`). */
import {useCallback, useEffect, useRef, useState, type ReactNode} from 'react';

import {Skeleton} from '@/components/varel/Skeleton';
import type {Dictionary, TFunction} from '@/lib/i18n';
import {useT} from '@/lib/i18n/react';
import type {ReviewEligibility, ReviewSort, ReviewSubmitResponse, ReviewsResponse} from '@/lib/types/reviews';

import {fetchEligibility, fetchReviews} from './api';
import {ReviewForm} from './ReviewForm';
import {ReviewList} from './ReviewList';
import {Summary} from './Summary';
import {WriteEntry} from './WriteEntry';

/** Fired on `window` when the visitor's own review went live, so the product page can refresh its rating line. */
export const REVIEWS_CHANGED_EVENT = 'varel:reviews-changed';

export interface ProductReviewsProps {
  slug: string;
  /** The product's name (form heading, empty state) */
  name: string;
  /** First page, newest first, read on the server; `null` when that read failed */
  initial: ReviewsResponse | null;
  dict: Dictionary;
  locale: string;
  /** Sign-in page with `?next=` back to this section */
  loginHref: string;
}

function Section({t, children, count}: {t: TFunction; children: ReactNode; count?: number}) {
  return (
    <section
      id="reviews"
      aria-labelledby="reviews-title"
      className="flex scroll-mt-24 flex-col gap-10 border-t border-hairline px-6 pt-12 pb-16 md:px-12 md:pt-[72px] md:pb-24"
    >
      <div className="flex items-baseline gap-4">
        <h2 id="reviews-title" className="font-display text-[28px] font-normal md:text-[34px]">
          {t('title')}
        </h2>
        {!!count && <span className="text-body-sm text-text-muted tabular-nums">{count}</span>}
      </div>
      {children}
    </section>
  );
}

export function ProductReviews({slug, name, initial, dict, locale, loginHref}: ProductReviewsProps) {
  const t = useT(dict, 'reviews');
  const [data, setData] = useState<ReviewsResponse | null>(initial);
  const [sort, setSort] = useState<ReviewSort>('newest');
  /** cursors[i] loads page i + 1 (page 1: null) */
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [fetching, setFetching] = useState(false);
  const [failed, setFailed] = useState(false);
  const [writing, setWriting] = useState(false);
  const [eligibility, setEligibility] = useState<ReviewEligibility | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const page = cursors.length;

  const load = useCallback(
    async (next: {sort: ReviewSort; cursors: (string | null)[]; fresh?: boolean; scroll?: boolean}) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      // The chosen sort and page show at once; the previous reviews stay (dimmed) until the new ones arrive.
      setSort(next.sort);
      setCursors(next.cursors);
      setFetching(true);
      setFailed(false);
      try {
        const res = await fetchReviews(
          slug,
          {sort: next.sort, cursor: next.cursors.at(-1) ?? null, page: next.cursors.length, fresh: next.fresh},
          ctrl.signal,
        );
        if (ctrl.signal.aborted) return;
        setData(res);
        if (next.scroll) listRef.current?.scrollIntoView({behavior: 'smooth', block: 'start'});
      } catch (err) {
        if ((err as Error)?.name === 'AbortError' || ctrl.signal.aborted) return;
        setFailed(true);
      } finally {
        if (abortRef.current === ctrl) setFetching(false);
      }
    },
    [slug],
  );

  const loadEligibility = useCallback(async () => {
    try {
      setEligibility(await fetchEligibility(slug));
    } catch {
      setEligibility(null); // the entry simply stays hidden
    }
  }, [slug]);

  // The server read failed: try once more in the browser (skeleton meanwhile, then the error with a retry).
  useEffect(() => {
    if (!initial) void load({sort: 'newest', cursors: [null]});
    return () => abortRef.current?.abort();
  }, [initial, load]);

  const enabled = data?.settings.enabled ?? false;
  useEffect(() => {
    if (enabled) void loadEligibility();
  }, [enabled, loadEligibility]);

  if (!data) {
    if (failed) {
      return (
        <Section t={t}>
          <p className="text-body-sm text-text-secondary">
            {t('loadError')}{' '}
            <button
              type="button"
              className="border-b border-strong pb-px text-text-primary"
              onClick={() => void load({sort: 'newest', cursors: [null]})}
            >
              {t('tryAgain')}
            </button>
          </p>
        </Section>
      );
    }
    return (
      <Section t={t}>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.6fr)] lg:gap-16" role="status" aria-busy="true">
          <div className="flex flex-col gap-4">
            <Skeleton className="h-14 w-24" />
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-24 w-full" />
          </div>
          <div className="flex flex-col gap-6">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        </div>
      </Section>
    );
  }

  const {summary, settings} = data;
  if (!settings.enabled && summary.count === 0) return null;

  const onDone = (res: ReviewSubmitResponse) => {
    void loadEligibility();
    if (res.status === 'approved') {
      void load({sort, cursors: [null], fresh: true});
      window.dispatchEvent(new CustomEvent(REVIEWS_CHANGED_EVENT, {detail: {slug}}));
    }
  };

  return (
    <Section t={t} count={summary.count}>
      <div className="grid gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.6fr)] lg:gap-16">
        <div className="flex flex-col gap-8 lg:sticky lg:top-24 lg:self-start">
          <Summary t={t} data={data} />
          {settings.enabled && !writing && (
            <WriteEntry t={t} eligibility={eligibility} loginHref={loginHref} onWrite={() => setWriting(true)} />
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-10">
          {writing && (
            <ReviewForm
              t={t}
              slug={slug}
              name={name}
              postingAs={eligibility?.postingAs}
              settings={settings}
              onClose={() => setWriting(false)}
              onDone={onDone}
              onSignedOut={() => {
                setWriting(false);
                setEligibility({canReview: false, reason: 'signin', postingAs: null});
              }}
            />
          )}
          {failed && (
            <p role="alert" className="text-body-sm text-text-secondary">
              {t('loadError')}{' '}
              <button type="button" className="border-b border-strong pb-px text-text-primary" onClick={() => void load({sort, cursors})}>
                {t('tryAgain')}
              </button>
            </p>
          )}
          <ReviewList
            ref={listRef}
            t={t}
            locale={locale}
            name={name}
            data={data}
            sort={sort}
            page={page}
            fetching={fetching}
            hasNext={!!data.nextCursor && !failed}
            onSort={(next) => void load({sort: next, cursors: [null]})}
            onPrevious={() => void load({sort, cursors: cursors.slice(0, -1), scroll: true})}
            onNext={() => data.nextCursor && void load({sort, cursors: [...cursors, data.nextCursor], scroll: true})}
          />
        </div>
      </div>
    </Section>
  );
}

export default ProductReviews;
