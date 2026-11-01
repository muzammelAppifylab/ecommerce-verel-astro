import {Breadcrumb, type BreadcrumbItem, type Dicts, TextProvider} from '@/components/varel';

export interface CatalogCrumbsProps {
  locale: string;
  /** `layout` (the trail's aria-label) */
  dicts: Dicts;
  items: BreadcrumbItem[];
}

/** The listing pages' breadcrumb, rendered on the server only (no client directive: zero JS). */
export function CatalogCrumbs({locale, dicts, items}: CatalogCrumbsProps) {
  return (
    <TextProvider locale={locale} dicts={dicts}>
      <Breadcrumb items={items} />
    </TextProvider>
  );
}
