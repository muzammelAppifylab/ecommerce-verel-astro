/* Brand story — VAREL `src/pages/About.tsx` (About.dc.html), as server HTML (no client JS). */
import {Img} from '@/components/varel/Img';
import {TextProvider, useLocale, useText, type Dicts} from '@/components/varel/text';
import {href, postLink} from '@/lib/links';

import {ABOUT_PHOTOS} from './photos';

/** `about:principles.<key>.term|text` */
const PRINCIPLES = ['form', 'texture', 'time', 'repair'] as const;

/** `about:figures.<key>.figure|caption` */
const FIGURES = ['founded', 'workshops', 'fibres', 'repairs'] as const;

const labelCls = 'text-label-sm tracking-label uppercase';

function AboutContent() {
  const t = useText('about');
  const locale = useLocale();
  return (
    <div className="mx-auto max-w-page">
      <section className="grid items-stretch gap-0.5 lg:grid-cols-[1fr_1.15fr]">
        <div className="flex flex-col justify-center gap-[22px] bg-chalk px-6 py-16 md:px-12 md:py-24">
          <span className={`${labelCls} text-text-muted`}>{t('hero.eyebrow')}</span>
          <h1 className="m-0 font-display text-[44px] leading-tight font-normal tracking-display md:text-[60px]">{t('hero.title')}</h1>
          <p className="m-0 max-w-[46ch] text-body-md text-text-secondary">{t('hero.body')}</p>
        </div>
        <div className="relative min-h-[360px] bg-ink-100 md:min-h-[560px]">
          <Img photo={ABOUT_PHOTOS.hero} alt={t('hero.alt')} ratio="fill" width={1600} sizes="(min-width: 1024px) 54vw, 100vw" priority media={false} />
        </div>
      </section>

      <section className="grid items-start gap-12 px-6 py-16 md:px-12 md:py-24 lg:grid-cols-2 lg:gap-20">
        <div className="flex flex-col gap-6">
          <h2 className="m-0 font-display text-[32px] leading-tight font-normal md:text-[40px]">{t('story.title')}</h2>
          <p className="m-0 text-body-md text-text-secondary">{t('story.p1')}</p>
          <p className="m-0 text-body-md text-text-secondary">{t('story.p2')}</p>
        </div>
        <dl className="m-0 flex flex-col border-t border-strong">
          {PRINCIPLES.map(key => (
            <div key={key} className="grid grid-cols-[96px_1fr] gap-6 border-b border-hairline py-6 sm:grid-cols-[120px_1fr]">
              <dt className={`${labelCls} text-text-muted`}>{t(`principles.${key}.term`)}</dt>
              <dd className="m-0 text-[15px] leading-body text-text-secondary">{t(`principles.${key}.text`)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="grid grid-cols-2 gap-10 bg-ink-900 px-6 py-16 text-text-inverse md:px-12 md:py-20 lg:grid-cols-4 lg:gap-12">
        {FIGURES.map(key => (
          <div key={key} className="flex flex-col gap-2.5">
            <span className="font-display text-[40px] leading-none md:text-[52px]">{t(`figures.${key}.figure`)}</span>
            <span className="text-body-xs text-text-muted">{t(`figures.${key}.caption`)}</span>
          </div>
        ))}
      </section>

      <section className="grid items-center gap-10 px-6 py-16 md:px-12 md:py-24 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-12">
        <div className="relative aspect-video w-full overflow-hidden bg-chalk">
          <Img photo={ABOUT_PHOTOS.mill} alt={t('made.alt')} ratio="fill" width={1600} sizes="(min-width: 1024px) 56vw, 100vw" media={false} />
        </div>
        <div className="flex flex-col gap-5">
          <span className={`${labelCls} text-text-muted`}>{t('made.eyebrow')}</span>
          <h2 className="m-0 font-display text-[32px] leading-tight font-normal md:text-[36px]">{t('made.title')}</h2>
          <p className="m-0 max-w-[46ch] text-[15px] leading-body text-text-secondary">{t('made.body')}</p>
          <a href={postLink('choosing-a-mill', locale)} className={`${labelCls} self-start border-b border-strong pb-1 text-text-primary hover:border-strong`}>
            {t('made.link')}
          </a>
        </div>
      </section>

      <section className="grid items-center gap-10 border-t border-hairline px-6 py-16 md:px-12 md:py-20 lg:grid-cols-2 lg:gap-16">
        <div className="flex flex-col gap-4">
          <h2 className="m-0 max-w-[24ch] font-display text-[32px] leading-tight font-normal md:text-[36px]">{t('visit.title')}</h2>
          <p className="m-0 max-w-[44ch] text-[15px] leading-body text-text-secondary">{t('visit.body')}</p>
        </div>
        <div className="flex flex-wrap gap-3 lg:justify-self-end">
          <a href={href('/contact/', locale)} className={`${labelCls} border-0 bg-ink-900 px-[26px] py-4 text-text-inverse hover:bg-ink-700 hover:text-text-inverse`}>
            {t('visit.contact')}
          </a>
          <a
            href={href('/shop/', locale)}
            className={`${labelCls} border border-strong px-[26px] py-4 text-text-primary hover:border-strong hover:bg-ink-900 hover:text-text-inverse`}>
            {t('visit.shop')}
          </a>
        </div>
      </section>
    </div>
  );
}

export function AboutView({locale, dicts}: {locale: string; dicts: Dicts}) {
  return (
    <TextProvider locale={locale} dicts={dicts}>
      <AboutContent />
    </TextProvider>
  );
}
