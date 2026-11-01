/* "Shop by category" (port of VAREL src/pages/home/ShopByCategory.tsx). Server-rendered only: the department
   tiles (3/4) from the taxonomy, in taxonomy order. The page leaves the section out when the taxonomy failed
   (VAREL hid it on error); there is no loading state on the server. */
import {Img} from '@/components/varel';
import {useLocale, useText} from '@/components/varel/text';
import {deptLink, shopLink} from '@/lib/links';
import type {Department} from '@/lib/types/catalog';

import {type HomeProps, HomeText} from './island';
import {DEPT_PHOTOS} from './photos';

function Tiles({departments}: {departments: Department[]}) {
  const t = useText('home');
  const locale = useLocale();
  return (
    <section className="px-6 pt-16 md:px-12 md:pt-24">
      <div className="mb-8 flex items-baseline justify-between gap-6">
        <h2 className="m-0 font-display text-display-4 font-normal">{t('categories.title')}</h2>
        <a href={shopLink(locale)} className="border-0 text-label-md tracking-label uppercase">
          {t('featured.allProducts')}
        </a>
      </div>
      <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-6">
        {departments.map(d => {
          const name = d.label ?? d.name;
          return (
            <a key={d.slug} href={deptLink(d.slug, locale)} className="flex flex-col gap-3.5 border-0">
              <div className="relative aspect-[3/4] overflow-hidden bg-ink-100">
                <Img
                  photo={DEPT_PHOTOS[d.slug]}
                  alt={t('categories.alt', {name})}
                  ratio="fill"
                  width={700}
                  sizes="(min-width: 1024px) 16vw, (min-width: 640px) 33vw, 50vw"
                />
              </div>
              <div className="flex flex-col gap-[5px]">
                <span className="text-label-md tracking-label text-text-primary uppercase">{name}</span>
                <span className="text-label-md text-text-muted">{t('pieces', {count: d.count})}</span>
              </div>
            </a>
          );
        })}
      </div>
    </section>
  );
}

export function ShopByCategory({departments, ...props}: HomeProps & {departments: Department[]}) {
  return (
    <HomeText {...props}>
      <Tiles departments={departments} />
    </HomeText>
  );
}
