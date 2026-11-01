import {useId} from 'react';

import {Card} from './display';
import {Field} from './form';

/**
 * SEO title and description overrides with live counts and a search-result
 * preview, ported from VAREL (`pages/admin/seo/SeoPanel.tsx`). Used by the
 * journal, pages, collections and products editors. Empty fields fall back to
 * the defaults shown as placeholders (the record's title and excerpt).
 */

export const SEO_TITLE_MAX = 70;
export const SEO_DESCRIPTION_MAX = 200;
/** Roughly where Google truncates. */
export const SEO_TITLE_SOFT = 60;
export const SEO_DESCRIPTION_SOFT = 160;

/** Cut to `n` characters with an ellipsis, as a results list does. */
export const clipText = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** Search-result preview: how a page reads in a results list. */
export function SearchPreview({title, description, url}: {title: string; description: string; url: string}) {
  return (
    <div className="seo-preview" role="group" aria-label="Search result preview">
      <p className="seo-preview-url">{url}</p>
      <p className="seo-preview-title">{clipText(title, SEO_TITLE_SOFT) || 'Untitled'}</p>
      <p className="seo-preview-description">{clipText(description, SEO_DESCRIPTION_SOFT) || 'No description yet.'}</p>
    </div>
  );
}

function Count({n, soft, max}: {n: number; soft: number; max: number}) {
  const tone = n > max ? 'danger' : n > soft ? 'warning' : undefined;
  return (
    <span className="seo-count" data-tone={tone}>
      {`${n}/${soft}`}
    </span>
  );
}

export function SeoPanel({
  seoTitle,
  seoDescription,
  onChange,
  fallbackTitle,
  fallbackDescription,
  path,
  titleSuffix = ' — VAREL',
  errors = {},
  disabled,
}: {
  seoTitle: string;
  seoDescription: string;
  onChange: (patch: {seoTitle?: string; seoDescription?: string}) => void;
  fallbackTitle: string;
  fallbackDescription: string;
  /** Storefront path for the preview, e.g. `/journal/choosing-a-mill/`. */
  path: string;
  titleSuffix?: string;
  /** Server or form errors, by field (`seoTitle`, `seoDescription`). */
  errors?: Record<string, string | undefined>;
  disabled?: boolean;
}) {
  const base = useId();
  const ids = {title: `${base}-seo-title`, desc: `${base}-seo-desc`};
  const fallback = fallbackTitle ? `${fallbackTitle}${titleSuffix}` : '';
  const shownTitle = seoTitle.trim() || fallback;
  const shownDesc = seoDescription.trim() || fallbackDescription;
  const origin = typeof window === 'undefined' ? '' : window.location.host;
  const describe = (id: string, error?: string) => (error ? `${id}-error` : `${id}-hint`);
  return (
    <Card title="Search and sharing" description="Leave empty to use the title and the excerpt.">
      <div className="seo-panel">
        <Field
          label="SEO title"
          id={ids.title}
          error={errors.seoTitle}
          hint={
            <>
              <Count n={seoTitle.trim().length} soft={SEO_TITLE_SOFT} max={SEO_TITLE_MAX} /> · used as the page title and on social cards
            </>
          }>
          <input
            id={ids.title}
            value={seoTitle}
            maxLength={SEO_TITLE_MAX}
            disabled={disabled}
            placeholder={fallback || undefined}
            aria-invalid={errors.seoTitle ? true : undefined}
            aria-describedby={describe(ids.title, errors.seoTitle)}
            onChange={e => onChange({seoTitle: e.target.value})}
          />
        </Field>
        <Field
          label="SEO description"
          id={ids.desc}
          error={errors.seoDescription}
          hint={
            <>
              <Count n={seoDescription.trim().length} soft={SEO_DESCRIPTION_SOFT} max={SEO_DESCRIPTION_MAX} /> · one or two plain sentences
            </>
          }>
          <textarea
            id={ids.desc}
            rows={3}
            value={seoDescription}
            maxLength={SEO_DESCRIPTION_MAX}
            disabled={disabled}
            placeholder={fallbackDescription || undefined}
            aria-invalid={errors.seoDescription ? true : undefined}
            aria-describedby={describe(ids.desc, errors.seoDescription)}
            onChange={e => onChange({seoDescription: e.target.value})}
          />
        </Field>
        <SearchPreview title={shownTitle} description={shownDesc} url={`${origin}${path}`} />
      </div>
    </Card>
  );
}
