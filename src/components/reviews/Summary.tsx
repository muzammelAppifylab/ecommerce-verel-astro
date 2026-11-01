/* Average, stars and the 5→1 distribution of a product's approved reviews (VAREL ProductReviews.tsx Summary).
   Bar widths go through the CSSOM (`useElementStyle`): the CSP blocks style="" attributes. */
import {useRef} from 'react';

import {useElementStyle} from '@/components/varel/element-style';
import {Stars} from '@/components/varel/Stars';
import type {TFunction} from '@/lib/i18n';
import {ratingText, type ReviewsResponse} from '@/lib/types/reviews';

function Bar({pct}: {pct: number}) {
  const ref = useRef<HTMLSpanElement>(null);
  useElementStyle(ref, {width: `${pct}%`});
  return <span ref={ref} className="absolute inset-y-0 left-0 w-0 bg-ink-900 transition-[width] duration-640 ease-out" />;
}

export function Summary({t, data}: {t: TFunction; data: ReviewsResponse}) {
  const {summary} = data;
  if (summary.count === 0) {
    return (
      <div className="flex flex-col gap-3">
        <Stars value={0} size={15} />
        <p className="text-body-sm text-text-secondary">{t('summary.first')}</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end gap-4">
        <span className="font-display text-[64px] leading-none font-light tracking-display tabular-nums">{ratingText(summary.avg)}</span>
        <div className="flex flex-col gap-2 pb-2">
          <Stars value={summary.avg} size={15} label={t('summary.rated', {avg: ratingText(summary.avg)})} />
          <span className="text-body-xs text-text-muted">{t('summary.basedOn', {count: summary.count})}</span>
        </div>
      </div>
      <dl className="flex flex-col gap-2.5">
        {(['5', '4', '3', '2', '1'] as const).map((k) => {
          const n = summary.distribution[k];
          const pct = summary.count ? (n / summary.count) * 100 : 0;
          return (
            <div key={k} className="grid grid-cols-[52px_minmax(0,1fr)_24px] items-center gap-3">
              <dt className="text-body-xs text-text-secondary">{t('stars', {count: Number(k)})}</dt>
              <dd className="relative h-[3px] bg-ink-100" aria-label={t('count', {count: n})}>
                <Bar pct={pct} />
              </dd>
              <span aria-hidden="true" className="text-right text-body-xs text-text-muted tabular-nums">
                {n}
              </span>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
