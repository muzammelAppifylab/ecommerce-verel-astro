import {useRef} from 'react';

import {cn} from '@/lib/utils';

import {useElementStyle} from './element-style';
import {useText} from './text';

export interface WordmarkProps {
  /** px: 24 in the site header, 22 on auth/checkout */
  size?: number;
  /** Links here (the localized home, e.g. "/da/"); null renders a plain span */
  href?: string | null;
  className?: string;
}

const SIZE: Record<number, string> = {20: 'text-[20px]', 22: 'text-[22px]', 24: 'text-[24px]'};

/** Type-set VAREL wordmark: Lato 300, 0.42em tracking with matching left padding for optical centring. */
export function Wordmark({size = 24, href = '/', className}: WordmarkProps) {
  const t = useText('layout');
  const ref = useRef<HTMLElement>(null);
  const known = SIZE[size];
  useElementStyle(ref, known ? undefined : {fontSize: size});
  const cls = cn(
    'wordmark font-sans font-light tracking-wordmark whitespace-nowrap text-text-primary uppercase',
    known,
    className
  );
  if (href === null)
    return (
      <span ref={ref} className={cls}>
        VAREL
      </span>
    );
  return (
    <a
      ref={ref as React.RefObject<HTMLAnchorElement>}
      href={href}
      aria-label={t('ui.home')}
      data-wordmark="true"
      className={cn(cls, 'border-0 hover:text-text-primary')}>
      VAREL
    </a>
  );
}
