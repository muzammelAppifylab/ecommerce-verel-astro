/* "New collections": two staggered editorial rows, knitwear then shirting (mirrored). Port of VAREL
   src/pages/home/NewCollections.tsx; server-rendered only. */
import {Icon, Img} from '@/components/varel';
import {useLocale, useText} from '@/components/varel/text';
import {searchLink} from '@/lib/links';
import type {Photo} from '@/lib/types/common';
import {cn} from '@/lib/utils';

import {type HomeProps, HomeText} from './island';
import {HOME_PHOTOS} from './photos';

const ctaCls =
  'mt-2 inline-flex items-center gap-3 self-start border border-strong px-[22px] py-[13px] font-sans text-label-sm tracking-label text-text-primary uppercase hover:border-strong hover:bg-ink-900 hover:text-text-inverse';

function Copy({title, body, cta, href}: {title: string; body: string; cta: string; href: string}) {
  const t = useText('home');
  return (
    <div className="flex flex-col gap-5">
      <span className="text-label-sm tracking-label text-text-primary uppercase">{t('newCollections.eyebrow')}</span>
      <h2 className="m-0 font-display text-[36px] leading-tight font-normal tracking-display md:text-display-3">{title}</h2>
      <p className="m-0 max-w-[34ch] text-[15px] leading-body text-text-secondary">{body}</p>
      <a href={href} className={ctaCls}>
        {cta}
        <Icon name="arrow-right" size={14} />
      </a>
    </div>
  );
}

function Frame({photo, alt, ratio, className}: {photo: Photo; alt: string; ratio: '3/4' | '4/5'; className?: string}) {
  return (
    <div
      className={cn('relative w-full overflow-hidden bg-ink-100', ratio === '3/4' ? 'aspect-[3/4]' : 'aspect-[4/5]', className)}>
      <Img photo={photo} alt={alt} ratio="fill" width={1200} sizes="(min-width: 1024px) 36vw, 50vw" media={false} />
    </div>
  );
}

function Rows() {
  const t = useText('home');
  const locale = useLocale();
  return (
    <section id="new-collections" className="flex flex-col gap-16 px-6 pb-16 md:gap-24 md:px-12 md:pb-24">
      <div className="grid grid-cols-2 items-center gap-6 md:gap-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)_minmax(0,0.8fr)]">
        <div className="col-span-2 lg:col-span-1">
          <Copy
            title={t('newCollections.knit.title')}
            body={t('newCollections.knit.body')}
            cta={t('newCollections.knit.cta')}
            href={searchLink('knitwear', locale)}
          />
        </div>
        <Frame photo={HOME_PHOTOS.new1a} alt={t('newCollections.knit.altA')} ratio="3/4" />
        <Frame photo={HOME_PHOTOS.new1b} alt={t('newCollections.knit.altB')} ratio="4/5" className="self-start lg:mt-14" />
      </div>
      <div className="grid grid-cols-2 items-center gap-6 md:gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <Frame
          photo={HOME_PHOTOS.new2a}
          alt={t('newCollections.shirt.altA')}
          ratio="4/5"
          className="order-2 self-end lg:order-none lg:mb-14"
        />
        <Frame photo={HOME_PHOTOS.new2b} alt={t('newCollections.shirt.altB')} ratio="3/4" className="order-3 lg:order-none" />
        <div className="order-1 col-span-2 lg:order-none lg:col-span-1">
          <Copy
            title={t('newCollections.shirt.title')}
            body={t('newCollections.shirt.body')}
            cta={t('newCollections.shirt.cta')}
            href={searchLink('shirt', locale)}
          />
        </div>
      </div>
    </section>
  );
}

export function NewCollections(props: HomeProps) {
  return (
    <HomeText {...props}>
      <Rows />
    </HomeText>
  );
}
