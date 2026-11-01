import {type ComponentProps, useRef} from 'react';

import {cn} from '@/lib/utils';

import {useElementStyle} from './element-style';

export type CardVariant = 'hairline' | 'sunken' | 'inverse' | 'plain';

const SKINS: Record<CardVariant, string> = {
  hairline: 'bg-surface-raised border border-hairline',
  sunken: 'bg-surface-sunken border-0',
  inverse: 'bg-surface-inverse text-text-inverse border-0',
  plain: 'bg-transparent border-0',
};

export interface CardProps extends Omit<ComponentProps<'div'>, 'style'> {
  variant?: CardVariant;
  /** Any CSS length; defaults to var(--space-6) (24px, the `p-6` class). Prefer a padding class in className. */
  padding?: string;
}

/** Neutral container. Hairlines and negative space carry hierarchy, never a drop shadow. */
export function Card({variant = 'hairline', padding, className, ...rest}: CardProps) {
  const ref = useRef<HTMLDivElement>(null);
  useElementStyle(ref, padding ? {padding} : undefined);
  return <div ref={ref} className={cn('rounded-none', !padding && 'p-6', SKINS[variant], className)} {...rest} />;
}
