/* "(The best part)": a category index beside a photo frame (port of VAREL src/pages/home/BestPart.tsx). The row
   under the pointer (or, without one, the row the scroll has reached) is lit and the frame crossfades to its
   photo. An island (`client:visible`); the rows are computed from the taxonomy read on the server, so the
   server HTML equals the first client render (scroll position is read only after mount). */
import {useEffect, useMemo, useRef, useState} from 'react';

import {Icon, Img} from '@/components/varel';
import {useLocale, useText} from '@/components/varel/text';
import {shopLink} from '@/lib/links';
import type {Department} from '@/lib/types/catalog';
import {cn} from '@/lib/utils';

import {type HomeProps, HomeText} from './island';
import {HOME_PHOTOS} from './photos';
import {rowData, scrolledRow} from './sections';

function Rows({departments}: {departments: Department[] | null}) {
  const t = useText('home');
  const tc = useText('catalog');
  const locale = useLocale();
  const rows = useMemo(() => rowData(departments, k => t(`bestPart.rows.${k}`), locale), [departments, t, locale]);
  const ref = useRef<HTMLElement>(null);
  const [scrolled, setScrolled] = useState(0);
  const [hovered, setHovered] = useState<number | null>(null);

  useEffect(() => {
    const onScroll = () => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setScrolled(scrolledRow(window.innerHeight, r.top, r.height));
    };
    window.addEventListener('scroll', onScroll, {passive: true});
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const known = !!departments;
  const active = Math.min(hovered ?? scrolled, Math.max(0, rows.length - 1));
  const current = rows[active];
  // Every photo stays mounted so the crossfade has both frames; the studio rail is the fallback underneath.
  const frames = [
    HOME_PHOTOS.bestPart,
    ...new Set(rows.map(r => r.photo).filter(p => p !== HOME_PHOTOS.bestPart)),
  ];

  return (
    <section
      id="best-part"
      ref={ref}
      className="grid gap-12 px-6 py-16 md:px-12 md:py-24 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] lg:gap-20">
      <div className="flex flex-col lg:py-6">
        <span className="font-sans text-label-sm tracking-label text-text-muted uppercase">{t('bestPart.eyebrow')}</span>
        <ul className="mt-8 border-t border-hairline" onMouseLeave={() => setHovered(null)}>
          {rows.map((r, i) => {
            const lit = i === active;
            return (
              <li key={r.key}>
                <a
                  href={r.link}
                  onMouseEnter={() => setHovered(i)}
                  onFocus={() => setHovered(i)}
                  onBlur={() => setHovered(null)}
                  className={cn(
                    'group grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-baseline gap-x-4 border-0 border-b border-hairline py-6 transition-[color] duration-240 ease-standard hover:border-hairline md:grid-cols-[3rem_minmax(0,1fr)_auto] md:py-7',
                    lit ? 'text-text-primary' : 'text-ink-400'
                  )}>
                  <span className="font-sans text-label-md tracking-label tabular-nums">{r.num}</span>
                  <span className="font-display text-[36px] leading-none font-normal tracking-display md:text-[52px]">
                    {r.name}
                  </span>
                  <span className="flex items-center gap-3 self-center font-sans text-label-sm tracking-label uppercase">
                    <span
                      className={cn(
                        'hidden transition-colors duration-240 sm:inline',
                        lit ? 'text-text-secondary' : 'text-ink-300'
                      )}>
                      {known ? tc('pieces', {count: r.count}) : ''}
                    </span>
                    <Icon
                      name="arrow-right"
                      size={16}
                      className={cn(
                        'transition-[transform,opacity] duration-240 ease-standard',
                        lit ? 'translate-x-0 opacity-100' : '-translate-x-2 opacity-0'
                      )}
                    />
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
        <p className="mt-10 mb-0 max-w-[42ch] text-[15px] leading-body text-text-secondary">{t('bestPart.body')}</p>
        <a
          href={shopLink(locale)}
          className="mt-7 inline-flex items-center gap-3 self-start border border-strong px-6 py-3.5 font-sans text-label-sm tracking-label text-text-primary uppercase hover:border-strong hover:bg-ink-900 hover:text-text-inverse">
          {t('shopCollection')}
          <Icon name="arrow-right" size={14} />
        </a>
      </div>

      <figure className="m-0 flex flex-col gap-4">
        <div className="relative aspect-[4/5] w-full overflow-hidden bg-ink-100">
          {frames.map(photo => {
            const shown = (current?.photo ?? HOME_PHOTOS.bestPart) === photo;
            return (
              <div
                key={photo.src}
                aria-hidden={!shown}
                className={cn(
                  'absolute inset-0 transition-opacity duration-640 ease-standard',
                  shown ? 'opacity-100' : 'opacity-0'
                )}>
                <Img
                  photo={photo}
                  alt={photo === HOME_PHOTOS.bestPart ? t('bestPart.alt') : ''}
                  ratio="fill"
                  width={1200}
                  sizes="(min-width: 1024px) 45vw, 100vw"
                  media={false}
                />
              </div>
            );
          })}
        </div>
        {current && (
          <figcaption className="flex items-baseline justify-between gap-4 font-sans text-label-sm tracking-label text-text-secondary uppercase">
            <span>
              <span className="text-text-muted tabular-nums">{current.num}</span> · {current.name}
            </span>
            {known && <span className="text-text-muted">{tc('pieces', {count: current.count})}</span>}
          </figcaption>
        )}
      </figure>
    </section>
  );
}

/** `departments` null (the taxonomy failed): the four rows without counts, linking to the shop (VAREL pre-load). */
export function BestPart({departments, ...props}: HomeProps & {departments: Department[] | null}) {
  return (
    <HomeText {...props}>
      <Rows departments={departments} />
    </HomeText>
  );
}
