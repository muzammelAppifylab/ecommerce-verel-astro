/* The home hero as the store shows it (VAREL `HomeHeroView`, the admin preview), with portal classes:
   the storefront's Tailwind cannot load in the dashboard. Inert: nothing in it can be clicked or focused. */
import {Fragment} from 'react';

import {photoUrl} from '../../../lib/format';
import {DEFAULT_HERO, type ResolvedHero} from './hero';

export function HeroPreview({hero}: {hero: ResolvedHero}) {
  const lines = hero.title.split('\n');
  const designed = hero.image.src === DEFAULT_HERO.image.src;
  return (
    <div className="cms-hero-preview" inert>
      <div className="cms-hero-copy">
        <span className="cms-hero-eyebrow">{hero.eyebrow}</span>
        <p className="cms-hero-title">
          {lines.map((l, i) => (
            <Fragment key={i}>
              {i > 0 && <br />}
              {l}
            </Fragment>
          ))}
        </p>
        <p className="cms-hero-body">{hero.body}</p>
        <div className="cms-hero-ctas">
          <span className="cms-hero-cta cms-hero-cta-solid">{hero.primaryCta.label}</span>
          <span className="cms-hero-cta">{hero.secondaryCta.label}</span>
        </div>
      </div>
      <div className="cms-hero-image">
        {hero.image.src && <img src={photoUrl(hero.image, 1000)} alt="" className={designed ? 'cms-hero-image-designed' : undefined} />}
      </div>
    </div>
  );
}
