import {ProductGrid, ProductGridItem} from '@/components/varel';
import type {ProductLike} from '@/components/varel/support';
import {type Dicts, TextProvider} from '@/components/varel/text';

/**
 * The collection's products in the curated order (island, `client:visible`): VAREL's
 * `<ProductGrid columns={4}>` of `ProductGridItem` — the heart toggles the wishlist, quick add puts
 * the first available variant in the bag and opens the drawer (F2's bag store). Props are trimmed
 * to what a tile reads (`toTileProduct`, ./seo.ts).
 */
export function CollectionProducts({products, locale, dicts}: {products: ProductLike[]; locale: string; dicts: Dicts}) {
  return (
    <TextProvider locale={locale} dicts={dicts}>
      <ProductGrid columns={4}>
        {products.map(p => (
          <ProductGridItem key={p.id} product={p} />
        ))}
      </ProductGrid>
    </TextProvider>
  );
}
