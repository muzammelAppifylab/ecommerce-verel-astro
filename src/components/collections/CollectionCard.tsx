import {Icon, Img} from '@/components/varel';
import {useLocale, useText} from '@/components/varel/text';
import {collectionLink} from '@/lib/links';
import {toPlainText} from '@/lib/rich-text';
import type {CollectionSummary} from '@/lib/types/collections';

/**
 * A collection card: 4/5 editorial image, then number · pieces, the title, a short line and
 * "Shop the edit" (VAREL `pages/collections/CollectionCard.tsx`). A plain link, rendered on the
 * server (no hydration); inside a <TextProvider> with the `collections` namespace.
 */
export function CollectionCard({c, index, sizes}: {c: CollectionSummary; index: number; sizes: string}) {
  const t = useText('collections');
  const locale = useLocale();
  const description = c.description ? toPlainText(c.description) : '';
  return (
    <a
      href={collectionLink(c.slug, locale)}
      data-card="true"
      className="group flex min-w-0 flex-col gap-5 border-0 text-text-primary hover:text-text-primary">
      <div data-media="true" className="relative aspect-[4/5] overflow-hidden bg-ink-100">
        {c.image && <Img photo={c.image} alt={t('imageAlt', {title: c.title})} ratio="fill" width={1200} sizes={sizes} />}
      </div>
      <div className="flex flex-col gap-3">
        <span className="text-label-sm tracking-label text-text-muted uppercase">
          {String(index + 1).padStart(2, '0')} · {t('pieces', {count: c.productCount})}
        </span>
        <h3 data-name="true" className="m-0 font-display text-[28px] leading-display font-normal tracking-display md:text-display-4">
          {c.title}
        </h3>
        {description && <p className="m-0 line-clamp-3 max-w-[46ch] text-body-sm text-text-secondary">{description}</p>}
        <span className="mt-1 inline-flex items-center gap-2.5 text-label-sm tracking-label uppercase">
          {t('card.cta')}
          <Icon name="arrow-right" size={14} />
        </span>
      </div>
    </a>
  );
}
