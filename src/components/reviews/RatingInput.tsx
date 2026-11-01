/* The five-star rating input of the review form (VAREL ProductReviews.tsx RatingInput): a radio group with
   a roving tab stop, hover preview, arrow keys and a live word for the chosen rating. */
import {useId, useState, type KeyboardEvent} from 'react';

import type {TFunction} from '@/lib/i18n';

const STAR = 'M10 1.6l2.47 5.18 5.68.7-4.18 3.93 1.07 5.63L10 14.29l-5.04 2.75 1.07-5.63L1.85 7.48l5.68-.7z';

export const RATING_GROUP_ID = 'review-rating';

export function RatingInput({
  t,
  value,
  onChange,
  error,
}: {
  t: TFunction;
  value: number;
  onChange: (v: number) => void;
  error?: string;
}) {
  const [hover, setHover] = useState(0);
  const labelId = useId();
  const errorId = useId();
  const shown = hover || value;
  const words = ['', t('rating.1'), t('rating.2'), t('rating.3'), t('rating.4'), t('rating.5')];
  const focusStar = (n: number) =>
    (document.querySelector(`#${RATING_GROUP_ID} [data-star="${n}"]`) as HTMLButtonElement | null)?.focus();
  const onKey = (e: KeyboardEvent) => {
    let next = 0;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = Math.min(5, (value || 0) + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = Math.max(1, (value || 2) - 1);
    if (!next) return;
    e.preventDefault();
    onChange(next);
    focusStar(next);
  };
  return (
    <div className="flex flex-col gap-2">
      <span id={labelId} className="text-label-md text-text-muted">
        {t('rating.label')}
      </span>
      <div className="flex items-center gap-4">
        <div
          id={RATING_GROUP_ID}
          role="radiogroup"
          aria-labelledby={labelId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="flex"
          onMouseLeave={() => setHover(0)}
          onKeyDown={onKey}
        >
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              data-star={n}
              aria-checked={value === n}
              aria-label={t('stars', {count: n})}
              tabIndex={value ? (value === n ? 0 : -1) : n === 1 ? 0 : -1}
              onClick={() => onChange(n)}
              onMouseEnter={() => setHover(n)}
              className="flex size-10 items-center justify-center border-0 text-ink-900"
            >
              <svg width="22" height="22" viewBox="0 0 20 20" aria-hidden="true">
                <path
                  d={STAR}
                  fill={n <= shown ? 'currentColor' : 'none'}
                  stroke="currentColor"
                  strokeWidth="1.1"
                  strokeLinejoin="round"
                  className="transition-[fill] duration-160"
                />
              </svg>
            </button>
          ))}
        </div>
        <span className="text-body-sm text-text-secondary" aria-live="polite">
          {words[shown]}
        </span>
      </div>
      {error && (
        <span id={errorId} className="text-label-md text-signal-critical">
          {error}
        </span>
      )}
    </div>
  );
}
