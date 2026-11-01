import {Fragment} from 'react';

import {
  Breadcrumb as UIBreadcrumb,
  BreadcrumbItem as UIBreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';

import {useText} from './text';

/** A trail step: a label, optionally with the (already localized) page it links to. */
export type BreadcrumbItem = string | {label: string; href?: string};

export interface BreadcrumbProps {
  items?: BreadcrumbItem[];
  className?: string;
}

/** Category trail on ui/breadcrumb. Three levels or fewer, slash separated.
 *  Items with `href` render as links; the last item is the current page. */
export function Breadcrumb({items = [], className}: BreadcrumbProps) {
  const t = useText('layout');
  return (
    <UIBreadcrumb className={className} aria-label={t('ui.breadcrumb')}>
      <BreadcrumbList>
        {items.map((it, i) => {
          const label = typeof it === 'string' ? it : it.label;
          const href = typeof it === 'string' ? undefined : it.href;
          const last = i === items.length - 1;
          return (
            <Fragment key={label + i}>
              <UIBreadcrumbItem>
                {last ? (
                  <BreadcrumbPage>{label}</BreadcrumbPage>
                ) : href ? (
                  <BreadcrumbLink href={href}>{label}</BreadcrumbLink>
                ) : (
                  <span>{label}</span>
                )}
              </UIBreadcrumbItem>
              {!last && <BreadcrumbSeparator />}
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </UIBreadcrumb>
  );
}
