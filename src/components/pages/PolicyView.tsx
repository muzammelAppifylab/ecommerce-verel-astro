/*
 * Privacy / Terms (server HTML, no client JS). Port of VAREL `src/pages/policy/PolicyLayout.tsx`,
 * `CmsPolicy.tsx`, `src/pages/Privacy.tsx` and `src/pages/Terms.tsx`: the CMS page ("privacy" / "terms",
 * admin → Pages) when it exists and is published, otherwise the built-in copy.
 *
 * Rendered by src/pages/{privacy,terms}.astro WITHOUT a client directive; words come from `dicts`
 * (`dictsFor(locale, {policy: true, privacy: true, layout: ['ui']})`).
 */
import {Fragment, type ReactNode} from 'react';

import {Breadcrumb} from '@/components/varel/Breadcrumb';
import {TextProvider, useLocale, useText, type Dicts} from '@/components/varel/text';
import {href} from '@/lib/links';
import type {CmsPage, PostBlock} from '@/lib/types/content';
import {cn} from '@/lib/utils';

import {Figure, Quote} from './PageBody';
import {FALLBACK_UPDATED, GUTTER, META, PAGE_TITLE, asRows, longDate, outlineAction, splitSections, underlineAction} from './policy';

export interface TocItem {
  id: string;
  label: string;
}
export interface RelatedLink {
  href: string;
  label: string;
}

/** Privacy / Terms page: breadcrumb, title + meta line, then the sticky contents + sections body. */
export function PolicyLayout({title, meta, toc, related, children}: {title: string; meta: ReactNode; toc: TocItem[]; related: RelatedLink[]; children: ReactNode}) {
  const t = useText('policy');
  const locale = useLocale();
  return (
    <div className="mx-auto w-full max-w-page">
      <Breadcrumb className={cn('pt-6', GUTTER)} items={[{label: t('home'), href: href('/', locale)}, {label: title}]} />
      <header className={cn('flex flex-col gap-3.5 border-b border-hairline pt-6 pb-10', GUTTER)}>
        <h1 className={PAGE_TITLE}>{title}</h1>
        <span className="text-[12px] leading-snug tracking-label text-text-muted uppercase">{meta}</span>
      </header>
      <PolicyBody toc={toc} related={related}>
        {children}
      </PolicyBody>
    </div>
  );
}

/** Two-column policy body: sticky "On this page" contents (260px) + a 62ch column of sections. */
export function PolicyBody({toc, related, children}: {toc: TocItem[]; related: RelatedLink[]; children: ReactNode}) {
  const t = useText('policy');
  return (
    <div className={cn('grid grid-cols-1 items-start gap-10 pt-10 pb-16 md:pt-12 md:pb-24 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-16', GUTTER)}>
      <nav aria-label={t('sections')} className="flex flex-col gap-3 lg:sticky lg:top-24">
        <span className={cn(META, 'pb-1.5')}>{t('onThisPage')}</span>
        {toc.map((item, i) => (
          <a key={`${item.id}-${i}`} href={`#${item.id}`} className="self-start border-0 text-body-sm leading-[1.5]">
            {item.label}
          </a>
        ))}
        <div className="mt-4 flex flex-col gap-3 border-t border-hairline pt-4">
          {related.map(r => (
            <a key={r.label} href={r.href} className="self-start border-0 text-body-sm leading-[1.5] text-text-secondary">
              {r.label}
            </a>
          ))}
        </div>
      </nav>
      <div className="flex max-w-[62ch] min-w-0 flex-col gap-10">{children}</div>
    </div>
  );
}

/** Opening paragraph, 18px primary ink. */
export function PolicyLead({children}: {children: ReactNode}) {
  return <p className="m-0 text-[17px] leading-[1.7] md:text-[18px]">{children}</p>;
}

/** One titled section. `ruled` adds the hairline above the closing section. */
export function PolicySection({id, title, ruled = false, children}: {id: string; title: string; ruled?: boolean; children: ReactNode}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cn('flex scroll-mt-24 flex-col gap-4', ruled && 'border-t border-hairline pt-8')}>
      <h2 id={`${id}-title`} className="m-0 font-display text-[28px] leading-[1.1] font-normal tracking-normal md:text-[32px]">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Body paragraph inside a section: 16px, 1.7 leading, secondary ink. */
export function PolicyP({children}: {children: ReactNode}) {
  return <p className="m-0 text-body-md leading-[1.7] text-text-secondary">{children}</p>;
}

/** Label / value rows with hairlines (Who we share it with, Refunds). 180px label column (VAREL default). */
export function PolicyRows({rows}: {rows: [string, string][]}) {
  return (
    <dl className="m-0 flex flex-col border-t border-hairline">
      {rows.map(([label, value], i) => (
        <div key={`${label}-${i}`} className="grid grid-cols-1 gap-2 border-b border-hairline py-[18px] sm:grid-cols-[180px_1fr] sm:gap-6">
          <dt className={META}>{label}</dt>
          <dd className="m-0 text-[15px] leading-body text-text-secondary">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function PolicyBlock({block, lead}: {block: PostBlock; lead?: boolean}) {
  switch (block.type) {
    case 'p':
      return lead ? <PolicyLead>{block.text}</PolicyLead> : <PolicyP>{block.text}</PolicyP>;
    case 'list': {
      const rows = asRows(block.items);
      if (rows) return <PolicyRows rows={rows} />;
      return (
        <ul className="m-0 flex list-disc flex-col gap-2.5 pl-[22px] text-body-md leading-[1.7] text-text-secondary">
          {block.items.map((it, i) => (
            <li key={i}>{it}</li>
          ))}
        </ul>
      );
    }
    // quotes and images look the same as in the journal
    case 'quote':
      return <Quote text={block.text} cite={block.cite} />;
    case 'image':
      return <Figure block={block} />;
    default:
      return null;
  }
}

/** A link at the end of a section. */
export interface ActionLink {
  href: string;
  label: string;
  /** `outline` (bordered) or `underline` (tracked, underlined). */
  kind: 'outline' | 'underline';
}

const Action = ({action}: {action: ActionLink}) => (
  <a href={action.href} className={action.kind === 'outline' ? outlineAction : underlineAction}>
    {action.label}
  </a>
);

/** `actions` adds links under a section, keyed by the section id (slug of its heading); `closing` ends the last section. */
export function CmsPolicy({
  page,
  related,
  metaSuffix,
  actions = {},
  closing,
}: {
  page: CmsPage;
  related: RelatedLink[];
  metaSuffix?: string;
  actions?: Record<string, ActionLink>;
  closing?: ActionLink;
}) {
  const t = useText('policy');
  const locale = useLocale();
  const updated = t('lastUpdated', {date: longDate(page.updatedAt, locale)});
  const {lead, sections} = splitSections(page.body);
  return (
    <PolicyLayout title={page.title} meta={metaSuffix ? `${updated} · ${metaSuffix}` : updated} toc={sections.map(s => ({id: s.id, label: s.title}))} related={related}>
      {lead.map((b, i) => (
        <PolicyBlock key={i} block={b} lead={i === 0 && b.type === 'p'} />
      ))}
      {sections.map((s, i) => {
        const last = i === sections.length - 1;
        const action = actions[s.id];
        return (
          <PolicySection key={`${s.id}-${i}`} id={s.id} title={s.title} ruled={last && !!closing}>
            {s.blocks.map((b, j) => (
              <Fragment key={j}>
                <PolicyBlock block={b} />
              </Fragment>
            ))}
            {action && <Action action={action} />}
            {last && closing && <Action action={closing} />}
          </PolicySection>
        );
      })}
    </PolicyLayout>
  );
}

/* ─── Privacy ───────────────────────────────────────────────────────────── */

/** Section ids (anchors) of the built-in copy; titles are `privacy:<id>.title`. */
const PRIVACY_SECTIONS = ['collect', 'use', 'share', 'cookies', 'rights', 'retention', 'contact'] as const;

function PrivacyContent({cms}: {cms: CmsPage | null}) {
  const t = useText('privacy');
  const tp = useText('policy');
  const locale = useLocale();
  const related = [
    {href: href('/terms/', locale), label: tp('related.terms')},
    {href: href('/returns/', locale), label: tp('related.returns')},
  ];
  const contact: ActionLink = {href: href('/contact/', locale), label: tp('contactStudio'), kind: 'outline'};
  if (cms) return <CmsPolicy page={cms} related={related} closing={contact} />;
  return (
    <PolicyLayout
      title={t('title')}
      meta={tp('lastUpdated', {date: longDate(FALLBACK_UPDATED, locale)})}
      toc={PRIVACY_SECTIONS.map(id => ({id, label: t(`${id}.title`)}))}
      related={related}>
      <PolicyLead>{t('lead')}</PolicyLead>

      <PolicySection id="collect" title={t('collect.title')}>
        <PolicyP>{t('collect.p1')}</PolicyP>
        <PolicyP>{t('collect.p2')}</PolicyP>
      </PolicySection>

      <PolicySection id="use" title={t('use.title')}>
        <PolicyP>{t('use.p1')}</PolicyP>
      </PolicySection>

      <PolicySection id="share" title={t('share.title')}>
        <PolicyRows rows={(['payments', 'carriers', 'email', 'never'] as const).map(k => [t(`share.${k}Label`), t(`share.${k}`)] as [string, string])} />
      </PolicySection>

      <PolicySection id="cookies" title={t('cookies.title')}>
        <PolicyP>{t('cookies.p1')}</PolicyP>
      </PolicySection>

      <PolicySection id="rights" title={t('rights.title')}>
        <PolicyP>{t('rights.p1')}</PolicyP>
      </PolicySection>

      <PolicySection id="retention" title={t('retention.title')}>
        <PolicyP>{t('retention.p1')}</PolicyP>
      </PolicySection>

      <PolicySection id="contact" title={t('contact.title')} ruled>
        <PolicyP>{t('contact.p1')}</PolicyP>
        <Action action={contact} />
      </PolicySection>
    </PolicyLayout>
  );
}

export function PrivacyView({locale, dicts, cms}: {locale: string; dicts: Dicts; cms: CmsPage | null}) {
  return (
    <TextProvider locale={locale} dicts={dicts}>
      <PrivacyContent cms={cms} />
    </TextProvider>
  );
}

/* ─── Terms ─────────────────────────────────────────────────────────────── */

/** Section anchors of the built-in copy → `policy:terms.<key>`. */
const TERMS_TOC = [
  {id: 'orders', key: 'orders'},
  {id: 'prices', key: 'prices'},
  {id: 'shipping', key: 'shipping'},
  {id: 'digital', key: 'digital'},
  {id: 'returns', key: 'cancellation'},
  {id: 'defects', key: 'defects'},
  {id: 'accounts', key: 'accounts'},
  {id: 'law', key: 'law'},
] as const;

function TermsContent({cms}: {cms: CmsPage | null}) {
  const t = useText('policy');
  const locale = useLocale();
  const related = [
    {href: href('/privacy/', locale), label: t('related.privacy')},
    {href: href('/returns/', locale), label: t('related.returns')},
  ];
  const contact: ActionLink = {href: href('/contact/', locale), label: t('contactStudio'), kind: 'outline'};
  const returns: ActionLink = {href: href('/returns/', locale), label: t('terms.cancellation.link'), kind: 'underline'};

  if (cms) return <CmsPolicy page={cms} related={related} metaSuffix={t('terms.company')} actions={{cancellation: returns}} closing={contact} />;
  return (
    <PolicyLayout
      title={t('terms.title')}
      meta={`${t('lastUpdated', {date: longDate(FALLBACK_UPDATED, locale)})} · ${t('terms.company')}`}
      toc={TERMS_TOC.map(({id, key}) => ({id, label: t(`terms.${key}.title`)}))}
      related={related}>
      <PolicyLead>{t('terms.lead')}</PolicyLead>

      <PolicySection id="orders" title={t('terms.orders.title')}>
        <PolicyP>{t('terms.orders.p1')}</PolicyP>
        <PolicyP>{t('terms.orders.p2')}</PolicyP>
      </PolicySection>

      <PolicySection id="prices" title={t('terms.prices.title')}>
        <PolicyP>{t('terms.prices.p1')}</PolicyP>
        <PolicyP>{t('terms.prices.p2')}</PolicyP>
      </PolicySection>

      <PolicySection id="shipping" title={t('terms.shipping.title')}>
        <PolicyP>{t('terms.shipping.p1')}</PolicyP>
        <PolicyP>{t('terms.shipping.p2')}</PolicyP>
      </PolicySection>

      <PolicySection id="digital" title={t('terms.digital.title')}>
        <PolicyP>{t('terms.digital.p1')}</PolicyP>
      </PolicySection>

      <PolicySection id="returns" title={t('terms.cancellation.title')}>
        <PolicyP>{t('terms.cancellation.p1')}</PolicyP>
        <Action action={returns} />
      </PolicySection>

      <PolicySection id="defects" title={t('terms.defects.title')}>
        <PolicyP>{t('terms.defects.p1')}</PolicyP>
      </PolicySection>

      <PolicySection id="accounts" title={t('terms.accounts.title')}>
        <PolicyP>{t('terms.accounts.p1')}</PolicyP>
      </PolicySection>

      <PolicySection id="law" title={t('terms.law.title')} ruled>
        <PolicyP>{t('terms.law.p1')}</PolicyP>
        <Action action={contact} />
      </PolicySection>
    </PolicyLayout>
  );
}

export function TermsView({locale, dicts, cms}: {locale: string; dicts: Dicts; cms: CmsPage | null}) {
  return (
    <TextProvider locale={locale} dicts={dicts}>
      <TermsContent cms={cms} />
    </TextProvider>
  );
}
