/* The list half of the reviews section (VAREL ProductReviews.tsx): count + sort, the reviews of the current
   page, and Previous / Next. Paging is keyset (cursor stack kept by ProductReviews); the page count comes
   from the total, as VAREL's numbered pager did. */
import {forwardRef} from 'react';

import {Select} from '@/components/varel/Select';
import type {TFunction} from '@/lib/i18n';
import type {ReviewSort, ReviewsResponse} from '@/lib/types/reviews';
import {cn} from '@/lib/utils';

import {LABEL, ReviewItem} from './ReviewItem';

/** Labels: `reviews:sort.<value>` */
export const SORTS: ReviewSort[] = ['newest', 'highest', 'lowest'];

const PAGER_BUTTON =
  'border-0 font-sans text-label-sm tracking-label uppercase transition-hover hover:text-ink-500 disabled:cursor-not-allowed disabled:text-text-disabled';

export const ReviewList = forwardRef<
  HTMLDivElement,
  {
    t: TFunction;
    locale: string;
    name: string;
    data: ReviewsResponse;
    sort: ReviewSort;
    page: number;
    fetching: boolean;
    hasNext: boolean;
    onSort: (sort: ReviewSort) => void;
    onPrevious: () => void;
    onNext: () => void;
  }
>(function ReviewList({t, locale, name, data, sort, page, fetching, hasNext, onSort, onPrevious, onNext}, ref) {
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  return (
    <div ref={ref} className="scroll-mt-28">
      {data.summary.count === 0 ? (
        <div className="flex flex-col gap-3 border-t border-hairline pt-8">
          <p className="font-display text-[24px] leading-snug">{t('empty.title')}</p>
          <p className="max-w-[52ch] text-[15px] leading-body text-text-secondary">{t('empty.body', {name})}</p>
        </div>
      ) : (
        <>
          <div className="flex items-end justify-between gap-6 border-b border-hairline pb-4">
            <span className={LABEL}>{t('count', {count: data.total})}</span>
            <Select
              aria-label={t('sort.label')}
              value={sort}
              options={SORTS.map((value) => ({value, label: t(`sort.${value}`)}))}
              onValueChange={(v) => onSort(v as ReviewSort)}
              className="w-44"
            />
          </div>
          <ol aria-busy={fetching || undefined} className={cn('flex flex-col transition-opacity duration-240', fetching && 'opacity-60')}>
            {data.items.map((r) => (
              <ReviewItem key={r.id} t={t} locale={locale} review={r} />
            ))}
          </ol>
          {pages > 1 && (
            <nav aria-label={t('pages.label')} className="flex items-center justify-between gap-4 border-t border-hairline pt-6">
              <button type="button" disabled={page <= 1 || fetching} onClick={onPrevious} className={PAGER_BUTTON}>
                {t('pages.previous')}
              </button>
              <span className="text-body-xs text-text-muted tabular-nums">{t('pages.status', {page, pages})}</span>
              <button type="button" disabled={!hasNext || page >= pages || fetching} onClick={onNext} className={PAGER_BUTTON}>
                {t('pages.next')}
              </button>
            </nav>
          )}
        </>
      )}
    </div>
  );
});
