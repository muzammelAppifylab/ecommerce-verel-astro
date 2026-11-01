/* Home hero (port of VAREL src/pages/home/HomeHero.tsx `HomeHeroView`). Server-rendered only (no JS):
   split chalk copy panel + full-bleed editorial image, 2px gutter. The content is resolved on the server
   (src/components/home/hero.ts `resolveHero` over Setting.homeHero, translated by the settings route). */
import {Fragment} from 'react';

import {buttonClasses, Img} from '@/components/varel';
import {isExternalUrl, localizeHref} from '@/components/varel/href';
import {useLocale, useText} from '@/components/varel/text';
import {cn} from '@/lib/utils';

import {type HeroCta, isDefaultHeroImage, type ResolvedHero} from './hero';
import {type HomeProps, HomeText} from './island';

/** A hero button: store paths get the language prefix; web links open in a new tab (mail links do not). */
function CtaLink({item, className}: {item: HeroCta; className: string}) {
  const locale = useLocale();
  const external = /^https?:/i.test(item.url);
  return (
    <a
      href={isExternalUrl(item.url) ? item.url : localizeHref(locale, item.url)}
      className={className}
      {...(external ? {target: '_blank', rel: 'noopener noreferrer'} : {})}>
      {item.label}
    </a>
  );
}

function HeroView({hero, priority = true, fullBleed = true}: {hero: ResolvedHero; priority?: boolean; fullBleed?: boolean}) {
  const t = useText('home');
  const lines = hero.title.split('\n');
  const designed = isDefaultHeroImage(hero.image);
  return (
    <section id="top" className="grid items-stretch gap-0.5 lg:grid-cols-[1fr_1.15fr]">
      <div
        className={cn(
          'flex flex-col justify-center gap-6 bg-chalk px-6 py-16 md:px-12 md:py-24',
          // align the copy with the page column (max-w-page 1440 + 48px gutter) while the chalk fills to the edge
          fullBleed && 'lg:pl-[max(3rem,calc((100vw-1440px)/2+3rem))]'
        )}>
        <span className="text-label-md tracking-loose text-text-secondary uppercase">{hero.eyebrow}</span>
        <h1 className="m-0 font-display text-[44px] leading-tight font-normal tracking-display md:text-display-2">
          {lines.map((l, i) => (
            <Fragment key={i}>
              {i > 0 && <br />}
              {l}
            </Fragment>
          ))}
        </h1>
        <p className="m-0 max-w-[40ch] text-body-md text-text-secondary">{hero.body}</p>
        <div className="mt-2 flex flex-wrap gap-4">
          <CtaLink item={hero.primaryCta} className={buttonClasses({variant: 'solid', size: 'lg'})} />
          <CtaLink item={hero.secondaryCta} className={buttonClasses({variant: 'outline', size: 'lg'})} />
        </div>
      </div>
      <div className="relative min-h-[420px] bg-ink-100 md:min-h-[560px] lg:min-h-[620px]">
        <Img
          photo={hero.image}
          alt={designed ? t('hero.alt') : ''}
          ratio="fill"
          width={1400}
          sizes="(min-width: 1024px) 54vw, 100vw"
          priority={priority}
          media={false}
          // The rail sits right of centre in the studio photo: keep it in frame when the panel is narrow.
          imgClassName={designed ? 'object-[62%_50%]' : undefined}
        />
      </div>
    </section>
  );
}

/** The storefront hero: `hero` comes resolved (stored fields over the translated designed copy). */
export function HomeHero({hero, ...props}: HomeProps & {hero: ResolvedHero}) {
  return (
    <HomeText {...props}>
      <HeroView hero={hero} />
    </HomeText>
  );
}
