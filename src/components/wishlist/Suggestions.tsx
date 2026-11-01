import {Container} from '@/components/varel/Container';
import {localizeHref} from '@/components/varel/href';
import {Img} from '@/components/varel/Img';
import {type Photo, priceText} from '@/components/varel/support';
import {useLocale, useText} from '@/components/varel/text';
import {cn} from '@/lib/utils';

import {UNDERLINE_LINK} from './ui';

/** The few product fields a suggestion card shows (the page trims the listing to these). */
export interface SuggestionCandidate {
  id: string;
  name: string;
  image: Photo | null;
  alt: string;
  price: number;
}

/** "You might also consider" (VAREL Wishlist.tsx `Suggestions`): the first products of the default listing
 *  that are not on the wishlist, four at most; hidden when none remain. Plain links. */
export function Suggestions({candidates, exclude}: {candidates: SuggestionCandidate[]; exclude: string[]}) {
  const t = useText('wishlist');
  const common = useText('common');
  const locale = useLocale();
  const list = candidates.filter(p => !exclude.includes(p.id)).slice(0, 4);
  if (!list.length) return null;
  return (
    <Container as="section" className="flex flex-col gap-7 border-t border-hairline pt-[72px] pb-24">
      <div className="flex items-baseline justify-between gap-8">
        <h2 className="m-0 font-display text-display-4 font-normal">{t('suggestions')}</h2>
        <a href={localizeHref(locale, '/shop/')} className={cn(UNDERLINE_LINK, 'shrink-0')}>
          {t('allProducts')}
        </a>
      </div>
      <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">
        {list.map(r => (
          <a
            key={r.id}
            href={localizeHref(locale, `/product/${encodeURIComponent(r.id)}/`)}
            data-card="true"
            className="flex min-w-0 flex-col gap-3 border-0 text-text-primary hover:text-text-primary">
            <Img photo={r.image} alt={r.alt} width={600} sizes="(min-width: 1024px) 23vw, 50vw" />
            <div className="flex items-baseline justify-between gap-3">
              <span data-name="true" className="font-display text-[19px] leading-display">
                {r.name}
              </span>
              <span className="text-body-sm">{priceText(r.price, common('free'))}</span>
            </div>
          </a>
        ))}
      </div>
    </Container>
  );
}
