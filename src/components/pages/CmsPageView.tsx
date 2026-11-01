/*
 * /pages/<slug>/ — a CMS page (admin → Pages) in the editorial measure, with contents when it has several
 * sections. Port of VAREL `src/pages/CmsPage.tsx` (server HTML, no client JS: the skeleton is gone, the page
 * arrives rendered). The 404 and "did not load" states are rendered by src/pages/pages/[slug].astro.
 */
import {Breadcrumb} from '@/components/varel/Breadcrumb';
import {TextProvider, useLocale, useText, type Dicts} from '@/components/varel/text';
import {href} from '@/lib/links';
import type {CmsPage} from '@/lib/types/content';
import {cn} from '@/lib/utils';

import {PageBody} from './PageBody';
import {GUTTER, META, PAGE_TITLE, headingsOf, longDate} from './policy';

function CmsPageContent({page}: {page: CmsPage}) {
  const t = useText('pages');
  const locale = useLocale();
  const toc = headingsOf(page.body);
  return (
    <div className="mx-auto w-full max-w-page">
      <Breadcrumb className={cn('pt-6', GUTTER)} items={[{label: t('home'), href: href('/', locale)}, {label: page.title}]} />
      <header className={cn('flex flex-col gap-3.5 border-b border-hairline pt-6 pb-10', GUTTER)}>
        <h1 className={PAGE_TITLE}>{page.title}</h1>
        <span className="text-[12px] leading-snug tracking-label text-text-muted uppercase">{t('lastUpdated', {date: longDate(page.updatedAt, locale)})}</span>
      </header>
      <div className={cn('grid grid-cols-1 items-start gap-10 pt-10 pb-16 md:pt-12 md:pb-24', toc.length > 1 && 'lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-16', GUTTER)}>
        {toc.length > 1 && (
          <nav aria-label={t('sections')} className="flex flex-col gap-3 lg:sticky lg:top-24">
            <span className={cn(META, 'pb-1.5')}>{t('onThisPage')}</span>
            {toc.map((h, i) => (
              <a key={`${h.id}-${i}`} href={`#${h.id}`} className="self-start border-0 text-body-sm leading-[1.5]">
                {h.text}
              </a>
            ))}
          </nav>
        )}
        <PageBody body={page.body} />
      </div>
    </div>
  );
}

/** The read failed (not a 404): say so, with a plain "Try again" link to the same address (no JS). */
function CmsPageError({retryHref}: {retryHref: string}) {
  const t = useText('pages');
  return (
    <div className={cn('mx-auto flex w-full max-w-page flex-col items-start gap-4 py-24', GUTTER)}>
      <p role="alert" className="m-0 text-body-md text-text-secondary">
        {t('loadError')}
      </p>
      <a
        href={retryHref}
        className="inline-flex h-11 items-center border border-strong px-6 text-label-sm tracking-label text-text-primary uppercase transition-hover hover:bg-ink-900 hover:text-text-inverse">
        {t('tryAgain')}
      </a>
    </div>
  );
}

export function CmsPageView({locale, dicts, page, retryHref}: {locale: string; dicts: Dicts; page: CmsPage | null; retryHref: string}) {
  return <TextProvider locale={locale} dicts={dicts}>{page ? <CmsPageContent page={page} /> : <CmsPageError retryHref={retryHref} />}</TextProvider>;
}
