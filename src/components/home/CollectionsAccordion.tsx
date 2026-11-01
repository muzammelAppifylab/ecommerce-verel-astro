/* Editorial image pair + an accordion of collections, one open at a time, "The Classics" by default (port of
   VAREL src/pages/home/CollectionsAccordion.tsx). An island (`client:visible`). Every panel's button goes to the
   shop, as in VAREL. */
import {useId, useState} from 'react';

import {Button, Icon, Img} from '@/components/varel';
import {useLocale, useText} from '@/components/varel/text';
import {shopLink} from '@/lib/links';
import {cn} from '@/lib/utils';

import {type HomeProps, HomeText} from './island';
import {HOME_PHOTOS} from './photos';
import {ACCORDION_ITEMS, ACCORDION_OPEN} from './sections';

function Accordion() {
  const [open, setOpen] = useState<string | null>(ACCORDION_OPEN);
  const t = useText('home');
  const locale = useLocale();
  const uid = useId();
  return (
    <section
      id="collections"
      className="grid items-start gap-12 px-6 pb-16 md:px-12 md:pb-24 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-[72px]">
      <div className="grid min-w-0 grid-cols-2 items-start gap-6">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="relative aspect-[4/5] overflow-hidden bg-ink-100">
            <Img
              photo={HOME_PHOTOS.collectionsA}
              alt={t('collections.altA')}
              ratio="fill"
              width={1000}
              sizes="(min-width: 1024px) 26vw, 50vw"
              media={false}
            />
          </div>
          <div className="flex items-center gap-2.5 text-label-sm tracking-label text-text-secondary uppercase">
            <span className="inline-block size-[7px] bg-ink-900" aria-hidden="true" />
            {t('collections.eyebrow')}
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-6 pt-2">
          <p className="m-0 text-body-md text-text-primary">{t('collections.body')}</p>
          <div className="relative aspect-[4/5] overflow-hidden bg-ink-100">
            <Img
              photo={HOME_PHOTOS.collectionsB}
              alt={t('collections.altB')}
              ratio="fill"
              width={1000}
              sizes="(min-width: 1024px) 26vw, 50vw"
              media={false}
            />
          </div>
        </div>
      </div>
      <div className="flex flex-col">
        {ACCORDION_ITEMS.map(c => {
          const isOpen = open === c.id;
          const panelId = `${uid}-${c.id}`;
          return (
            <div key={c.id} className="border-t border-hairline">
              <h3 className="m-0">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : c.id)}
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  className="group/row flex w-full items-center justify-between gap-6 border-0 bg-transparent py-6 text-left">
                  <span className="font-display text-[20px] text-text-primary sm:whitespace-nowrap">
                    {t(`collections.items.${c.id}.title`)}{' '}
                    <span className="font-sans text-body-xs text-text-muted">{c.year}</span>
                  </span>
                  <span
                    aria-hidden="true"
                    className={cn(
                      'flex size-10 flex-none items-center justify-center rounded-full border border-strong text-ink-900 transition-[background-color,color] duration-160 ease-standard group-hover/row:bg-ink-900 group-hover/row:text-ink-000',
                      isOpen && 'bg-ink-900 text-ink-000'
                    )}>
                    <Icon name="plus" size={16} className={cn('transition-transform duration-240 ease-out', isOpen && 'rotate-45')} />
                  </span>
                </button>
              </h3>
              {isOpen && (
                <div id={panelId} role="region" className="flex max-w-[46ch] flex-col items-start gap-5 pb-8">
                  <p className="m-0 text-[15px] leading-body text-text-secondary">
                    {t(`collections.items.${c.id}.description`)}
                  </p>
                  <Button href={shopLink(locale)} variant="outline" size="sm">
                    {t('shopCollection')}
                  </Button>
                </div>
              )}
            </div>
          );
        })}
        <div className="border-t border-hairline" />
      </div>
    </section>
  );
}

export function CollectionsAccordion(props: HomeProps) {
  return (
    <HomeText {...props}>
      <Accordion />
    </HomeText>
  );
}
