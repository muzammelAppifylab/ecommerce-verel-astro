/* The PDP trail (VAREL Product.tsx crumbs): F2's Breadcrumb in the page language, rendered on the server with no
   client directive (static HTML, no JS). */
import {Breadcrumb, type BreadcrumbItem} from '@/components/varel/Breadcrumb';
import {type Dicts, TextProvider} from '@/components/varel/text';

export function ProductBreadcrumb({items, locale, dicts}: {items: BreadcrumbItem[]; locale: string; dicts: Dicts}) {
  return (
    <TextProvider locale={locale} dicts={dicts}>
      <Breadcrumb items={items} />
    </TextProvider>
  );
}
