import {Link} from '@tanstack/react-router';

import {photoUrl} from '../../../lib/format';
import type {ProductStatus} from '../../../lib/types/admin/catalog';
import {useMe} from '../../shared';
import {StatusBadge, type Tone} from '../../ui';

/**
 * Pieces shared by the merchandising screens (VAREL `pages/admin/collections/*` and the bits of
 * `pages/admin/products/ui.tsx` they used: `Thumb`, the status chip).
 */

/** Staff who may only read (e.g. discounts staff) see the screens without edit controls. */
export function useMerchReadOnly(): boolean {
  const me = useMe();
  return !me.data?.abilities.manageProducts;
}

/** A small portrait thumbnail (grey box when there is no image). */
export function Thumb({src, size = 'md'}: {src?: string | null; size?: 'md' | 'lg'}) {
  return (
    <span className={`merch-thumb merch-thumb-${size}`} aria-hidden="true">
      {src && <img src={photoUrl(src, 120)} alt="" loading="lazy" decoding="async" />}
    </span>
  );
}

const PRODUCT_TONES: Record<ProductStatus, Tone> = {published: 'success', draft: 'neutral', archived: 'warning'};
const PRODUCT_LABELS: Record<ProductStatus, string> = {published: 'Published', draft: 'Draft', archived: 'Archived'};

/** A product's status chip (shown only when it is not published, as VAREL did). */
export function ProductStatusBadge({status}: {status: ProductStatus}) {
  return <StatusBadge tone={PRODUCT_TONES[status] ?? 'neutral'}>{PRODUCT_LABELS[status] ?? status}</StatusBadge>;
}

/** "1 product" / "3 products". */
export const productCount = (n: number) => `${n} ${n === 1 ? 'product' : 'products'}`;

/** Sub-navigation for Catalog › Collections: the collections and the manual order inside categories. */
export function MerchTabs() {
  return (
    <nav aria-label="Merchandising" className="merch-tabs">
      <Link to="/collections" activeOptions={{exact: true}} className="merch-tab" activeProps={{'aria-current': 'page'}}>
        Collections
      </Link>
      <Link to="/collections/category-order" className="merch-tab" activeProps={{'aria-current': 'page'}}>
        Category order
      </Link>
    </nav>
  );
}

/** Rows of grey bars while a list loads. */
export function RowSkeletons({rows}: {rows: number}) {
  return (
    <div className="merch-list" aria-busy="true" role="status">
      <span className="visually-hidden">Loading…</span>
      {Array.from({length: rows}, (_, i) => (
        <div key={i} className="merch-skeleton-row">
          <span className="skeleton merch-skeleton-thumb" />
          <span className="skeleton merch-skeleton-line" />
        </div>
      ))}
    </div>
  );
}
