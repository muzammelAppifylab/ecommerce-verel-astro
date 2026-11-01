import {Link} from '@tanstack/react-router';
import type {ReactNode} from 'react';

import type {AdminAnalytics} from '../../../lib/types/admin/analytics';
import type {ProductsSearch} from '../../queries';
import {ProgressBar} from '../../ui';

/**
 * Analytics pieces (VAREL src/pages/admin/analytics/Analytics.tsx): the funnel, ranked bar lists, inline bars,
 * search terms. One ink hue throughout; bars are the kit's `ProgressBar` (SVG, no inline style under the CSP).
 */

export const pct = (n: number, digits = 1) => `${(n * 100).toFixed(digits)}%`;
export const share = (n: number, of: number) => (of > 0 ? n / of : 0);

export function Empty({children}: {children: ReactNode}) {
  return <p className="analytics-empty">{children}</p>;
}

/** Funnel: step bars scaled to sessions, the step-to-step rate under each. */
export function Funnel({steps}: {steps: AdminAnalytics['funnel']}) {
  const top = steps[0]?.count ?? 0;
  if (!top) return <Empty>No sessions recorded in this range.</Empty>;
  return (
    <ol className="funnel" aria-label="Checkout funnel">
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1]!.count : null;
        const w = Math.min(1, share(s.count, top));
        return (
          <li key={s.key} className="funnel-step">
            <div className="funnel-head">
              <span>{s.label}</span>
              <span className="funnel-figures">
                <span>{s.count.toLocaleString('en-US')}</span>
                <span className="funnel-pct">{pct(w)}</span>
              </span>
            </div>
            <ProgressBar value={Math.max(w * 100, s.count ? 0.6 : 0)} max={100} label={`${s.label}: ${s.count.toLocaleString('en-US')}`} />
            {prev !== null &&
              (s.count > prev ? (
                // Paid orders are counted even when the buyer declined analytics, so they can outnumber tracked checkouts.
                <span className="funnel-note">More than the step before: includes buyers who declined analytics</span>
              ) : (
                <span className="funnel-note">{pct(share(s.count, prev))} of the step before</span>
              ))}
          </li>
        );
      })}
    </ol>
  );
}

export interface BarRow {
  key: string;
  label: string;
  sub?: string;
  value: number;
  meta?: string;
  /** The products screen filtered to this row (department, category); none for "Unlisted". */
  products?: ProductsSearch;
}

/** Ranked magnitudes: label (a link to the products when it has one), value and share, a bar and the units. */
export function BarList({rows, format, empty}: {rows: BarRow[]; format: (n: number) => string; empty: string}) {
  if (!rows.length) return <Empty>{empty}</Empty>;
  const max = Math.max(...rows.map(r => r.value), 0);
  const total = rows.reduce((n, r) => n + r.value, 0);
  return (
    <ul className="bar-list">
      {rows.map(r => {
        const label = (
          <>
            {r.label}
            {r.sub && <span className="muted"> · {r.sub}</span>}
          </>
        );
        return (
          <li key={r.key} className={r.products ? 'bar-row is-link' : 'bar-row'}>
            {r.products ? (
              <Link className="bar-label" to="/products" search={r.products} title={`View ${r.label} products`}>
                {label}
              </Link>
            ) : (
              <span className="bar-label">{label}</span>
            )}
            <span className="bar-value">
              {format(r.value)} <span className="bar-share">{pct(share(r.value, total), 0)}</span>
            </span>
            <span className="bar-track">
              <ProgressBar value={Math.max(0, r.value)} max={max || 1} label={`${r.label}: ${format(r.value)}`} />
              {r.meta && <span className="bar-meta">{r.meta}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** A number with a small bar beside it (the bar hides on phones). */
export function InlineBar({value, max, label}: {value: number; max: number; label: string}) {
  return (
    <span className="inline-bar">
      <span className="inline-bar-track">
        <ProgressBar value={value} max={max || 1} label={label} />
      </span>
      <span className="inline-bar-value">{value.toLocaleString('en-US')}</span>
    </span>
  );
}

/** A search term that opens the storefront search for it in a new tab, to see what shoppers saw. */
export function SearchTerm({query}: {query: string}) {
  return (
    <a
      className="search-term"
      href={`/search/?q=${encodeURIComponent(query)}`}
      target="_blank"
      rel="noopener noreferrer"
      title="See these results in the store">
      “{query}”
    </a>
  );
}
