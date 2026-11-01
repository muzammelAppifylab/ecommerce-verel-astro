import type {ReactNode} from 'react';

import {
  Button,
  EmptyState,
  localizeHref,
  ProductGrid,
  ProductGridItem,
  ProductGridSkeleton,
  productMeta,
  useLocale,
  useText,
} from '@/components/varel';
import type {Product} from '@/lib/types/catalog';
import {cn} from '@/lib/utils';

export interface ProductResultsProps {
  items: Product[] | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry?: () => void;
  /** Dims the grid while a new filter result loads (previous data stays visible) */
  isFetching?: boolean;
  /** Shown when `items` is empty */
  empty: ReactNode;
  /** Meta line under the name; default "Dept · Category · Material" */
  meta?: (p: Product) => string;
  /** Colours highlighted on tile swatches */
  selectedColors?: string[];
  /** Swatch click (Shop toggles the colour filter) */
  onSelectColor?: (name: string) => void;
  skeletonCount?: number;
}

/** The listing grid with loading skeletons, an error block and an empty slot (port of VAREL ProductResults). */
export function ProductResults({
  items,
  isLoading,
  isError,
  onRetry,
  isFetching,
  empty,
  meta = productMeta,
  selectedColors = [],
  onSelectColor,
  skeletonCount = 9,
}: ProductResultsProps) {
  const t = useText('catalog');
  const locale = useLocale();
  if (isLoading && !items) return <ProductGridSkeleton count={skeletonCount} columns={3} />;

  if (isError && !items) {
    return (
      <EmptyState
        title={t('results.errorTitle')}
        description={t('results.errorBody')}
        action={
          onRetry && (
            <Button variant="outline" onClick={onRetry}>
              {t('results.tryAgain')}
            </Button>
          )
        }
      />
    );
  }

  if (!items?.length) return <>{empty}</>;

  return (
    <ProductGrid columns={3} className={cn('transition-opacity duration-200', isFetching && 'opacity-60')}>
      {items.map((p, i) => (
        <ProductGridItem
          key={p.id}
          product={p}
          // The first row on a phone (two tiles) is above the fold: the likely LCP image, so not lazy.
          priority={i < 2}
          href={localizeHref(locale, `/product/${encodeURIComponent(p.id)}/`)}
          meta={meta(p)}
          selectedColor={p.swatches.find(w => selectedColors.includes(w.name))?.name ?? null}
          onSelectColor={onSelectColor}
        />
      ))}
    </ProductGrid>
  );
}
