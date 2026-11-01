/* Port of VAREL src/pages/product/ProductGallery.tsx: an island (`client:visible`); the server HTML already
   shows the hero image (eager, fetchpriority high), so only the thumbnails wait for hydration. */
import {type KeyboardEvent, useState} from 'react';

import {Badge} from '@/components/varel/Badge';
import {Img} from '@/components/varel/Img';
import {type Dicts, TextProvider, useText} from '@/components/varel/text';
import {badgeTone as toneOf} from '@/lib/product';
import type {Photo} from '@/lib/types/common';
import {cn} from '@/lib/utils';

export interface ProductGalleryProps {
  name: string;
  alt: string;
  gallery: Photo[];
  badge: string | null;
  /** Defaults to the tone the badge text implies */
  badgeTone?: 'ink' | 'quiet';
}

/** The island: the page's `product` words (dictsFor) and language around the gallery. */
export function ProductGalleryIsland({locale, dicts, ...props}: ProductGalleryProps & {locale: string; dicts: Dicts}) {
  return (
    <TextProvider locale={locale} dicts={dicts}>
      <ProductGallery {...props} />
    </TextProvider>
  );
}

/** Hero image (3/4) with a row of square thumbnails. Arrow keys step through the views. */
export function ProductGallery({name, alt, gallery, badge, badgeTone}: ProductGalleryProps) {
  const t = useText('product');
  const [index, setIndex] = useState(0);
  const count = gallery.length;
  const current = Math.min(index, Math.max(0, count - 1));
  const hero = gallery[current];

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (count < 2) return;
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (current + 1) % count;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (current - 1 + count) % count;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = count - 1;
    if (next === null) return;
    e.preventDefault();
    setIndex(next);
    const btn = e.currentTarget.querySelector<HTMLButtonElement>(`[data-thumb="${next}"]`);
    btn?.focus();
  };

  return (
    <div className="flex min-w-0 flex-col gap-[2px]" role="region" aria-label={t('gallery.images', {name})}>
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-chalk">
        {hero && (
          <Img
            key={hero.src}
            photo={hero}
            alt={current === 0 ? alt : t('gallery.view', {name, n: current + 1})}
            ratio="fill"
            width={1200}
            sizes="(min-width: 1024px) 55vw, 100vw"
            media={false}
            priority
          />
        )}
        {badge && (
          <span className="absolute top-0 left-0 z-1">
            <Badge tone={badgeTone ?? toneOf(badge)}>{badge}</Badge>
          </span>
        )}
      </div>
      {count > 1 && (
        <div className="grid grid-cols-3 gap-[2px]" role="group" aria-label={t('gallery.choose')} onKeyDown={onKeyDown}>
          {gallery.map((g, i) => {
            const on = i === current;
            return (
              <button
                key={g.src + i}
                type="button"
                data-thumb={i}
                onClick={() => setIndex(i)}
                aria-label={t('gallery.viewImage', {n: i + 1})}
                aria-pressed={on}
                tabIndex={on ? 0 : -1}
                className={cn(
                  'relative aspect-square w-full overflow-hidden border-0 bg-chalk p-0 transition-hover',
                  on ? 'opacity-100' : 'opacity-56 hover:opacity-80'
                )}>
                <Img
                  photo={g}
                  alt={t('gallery.view', {name, n: i + 1})}
                  ratio="fill"
                  width={500}
                  sizes="(min-width: 1024px) 18vw, 33vw"
                  media={false}
                />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
