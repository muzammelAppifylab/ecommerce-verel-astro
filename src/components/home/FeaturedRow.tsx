/* The "Featured" product row (first half of VAREL src/pages/home/FeaturedEdit.tsx). An island
   (`client:visible`) for the tiles' quick add and hearts; the products are read on the server
   (`/products?featured=true&limit=8`). The page leaves it out when the read failed or there are none. */
import {useLocale, useText} from '@/components/varel/text';
import {shopLink} from '@/lib/links';
import type {Product} from '@/lib/types/catalog';

import {HomeProductCard} from './HomeProductCard';
import {type HomeProps, HomeText} from './island';
import {featuredSlice} from './sections';

function Row({items, currency}: {items: Product[]; currency?: string}) {
  const t = useText('home');
  const locale = useLocale();
  return (
    <div>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-6">
        <div className="flex flex-col gap-2.5">
          <span className="text-label-md tracking-loose text-text-secondary uppercase">{t('featured.eyebrow')}</span>
          <h2 className="m-0 font-display text-[36px] leading-tight font-normal tracking-display md:text-display-3">
            {t('featured.title')}
          </h2>
        </div>
        <a href={shopLink(locale)} className="border-0 text-label-md tracking-label uppercase">
          {t('featured.allProducts')}
        </a>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-10 sm:gap-x-5 lg:grid-cols-4 lg:gap-y-12">
        {featuredSlice(items).map(p => (
          <HomeProductCard key={p.id} product={p} currency={currency} />
        ))}
      </div>
    </div>
  );
}

export function FeaturedRow({items, ...props}: HomeProps & {items: Product[]}) {
  if (items.length === 0) return null;
  return (
    <HomeText {...props}>
      <Row items={items} currency={props.currency} />
    </HomeText>
  );
}
