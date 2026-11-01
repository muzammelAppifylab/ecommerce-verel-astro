/* One approved review (VAREL ProductReviews.tsx ReviewItem). Body and reply are plain text, never HTML. */
import {Stars} from '@/components/varel/Stars';
import {formatDateLong} from '@/lib/format';
import type {TFunction} from '@/lib/i18n';
import type {PublicReview} from '@/lib/types/reviews';

export const LABEL = 'font-sans text-label-sm tracking-label text-text-muted uppercase';

export function ReviewItem({t, locale, review: r}: {t: TFunction; locale: string; review: PublicReview}) {
  return (
    <li className="flex flex-col gap-3 border-b border-hairline py-8 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <Stars value={r.rating} label={t('item.outOf', {rating: r.rating})} />
        <time dateTime={r.createdAt} className="text-body-xs text-text-muted">
          {formatDateLong(r.createdAt, locale)}
        </time>
      </div>
      <h3 className="font-display text-[22px] leading-snug font-normal">{r.title}</h3>
      <p className="max-w-[62ch] text-[15px] leading-body whitespace-pre-line text-text-secondary">{r.body}</p>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-body-xs text-text-primary">
        <span>{r.name}</span>
        {r.verifiedPurchase && (
          <span className="inline-flex items-center gap-1.5 font-sans text-label-sm tracking-label text-text-muted uppercase">
            <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true" fill="none">
              <path d="M2.5 6.2l2.2 2.2 4.8-4.8" stroke="currentColor" strokeWidth="1.2" />
            </svg>
            {t('item.verified')}
          </span>
        )}
      </p>
      {r.reply && (
        <div className="mt-2 flex flex-col gap-1.5 border-l border-strong py-1 pl-5">
          <span className={LABEL}>{t('item.reply')}</span>
          <p className="max-w-[60ch] text-body-sm leading-body whitespace-pre-line text-text-secondary">{r.reply}</p>
        </div>
      )}
    </li>
  );
}
