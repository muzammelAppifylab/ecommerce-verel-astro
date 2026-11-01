import type {QueryClient} from '@tanstack/react-query';

import {clean, listOf, oneOf, pageNum, type RawSearch, str} from './search-params';

/**
 * Products (`/dashboard/products`, `/new`, `/$id`). WP-17 owns this file
 * (`/site-api/manage/products`); WP-18's variants section reads through it.
 */

export const PRODUCT_STATUSES = ['draft', 'published', 'archived'] as const;
export const STOCK_FILTERS = ['in', 'low', 'out', 'digital'] as const;
export const PRODUCT_SORTS = ['name', '-name', 'price', '-price', 'inventory', '-inventory', 'updatedAt', '-updatedAt'] as const;
export const DEFAULT_PRODUCT_SORT = '-updatedAt';

export interface ProductsSearch {
  q?: string;
  status?: (typeof PRODUCT_STATUSES)[number][];
  dept?: string;
  category?: string;
  stock?: (typeof STOCK_FILTERS)[number][];
  sort?: (typeof PRODUCT_SORTS)[number];
  page?: number;
}

export function validateProductsSearch(raw: RawSearch): ProductsSearch {
  const sort = oneOf(raw.sort, PRODUCT_SORTS);
  return clean({
    q: str(raw.q),
    status: listOf(raw.status, PRODUCT_STATUSES),
    dept: str(raw.dept),
    category: str(raw.category),
    stock: listOf(raw.stock, STOCK_FILTERS),
    sort: sort === DEFAULT_PRODUCT_SORT ? undefined : sort,
    page: pageNum(raw.page),
  });
}

/** WP-17 implements. */
export const loadProducts = (_queryClient: QueryClient, _search: ProductsSearch): Promise<void> => Promise.resolve();
/** WP-17 implements (taxonomy and the settings the editor needs). */
export const loadNewProduct = (_queryClient: QueryClient): Promise<void> => Promise.resolve();
/** WP-17 implements. */
export const loadProduct = (_queryClient: QueryClient, _id: string): Promise<void> => Promise.resolve();
