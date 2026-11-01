import {type ComponentProps, type ElementType, type ReactNode, useRef} from 'react';

import {cn} from '@/lib/utils';

import {useElementStyle} from './element-style';

export interface EyebrowProps extends ComponentProps<'span'> {
  /** sm 11px (default) · md 12px · lg 13px */
  size?: 'sm' | 'md' | 'lg';
  /** muted (default) · secondary · primary · inverse */
  tone?: 'muted' | 'secondary' | 'primary' | 'inverse';
  as?: ElementType;
}

const SIZE = {sm: 'text-label-sm', md: 'text-label-md', lg: 'text-label-lg'};
const TONE = {
  muted: 'text-text-muted',
  secondary: 'text-text-secondary',
  primary: 'text-text-primary',
  inverse: 'text-text-inverse',
};

/** Tracked uppercase micro-label ("Filter", "Order summary", section kickers). Write it sentence case. */
export function Eyebrow({size = 'sm', tone = 'muted', as: Tag = 'span', className, ...rest}: EyebrowProps) {
  return (
    <Tag className={cn('m-0 font-sans font-normal tracking-label uppercase', SIZE[size], TONE[tone], className)} {...rest} />
  );
}

export interface SectionHeadingProps {
  title: ReactNode;
  /** Eyebrow label above the title */
  eyebrow?: ReactNode;
  /** Supporting copy (15px secondary) */
  description?: ReactNode;
  /** Right-aligned slot (e.g. "View all" link) */
  action?: ReactNode;
  /** Heading level; default h2 */
  as?: 'h1' | 'h2' | 'h3';
  /** Display size in px (prototype: 56 page titles, 44 section, 32 smaller sections) */
  size?: number;
  className?: string;
}

/* clamp(min(size,32)px, size/14.4 vw, size px) as classes for the prototype sizes (the CSP forbids style=""). */
const HEADING: Record<number, string> = {
  32: 'text-[clamp(32px,2.22vw,32px)]',
  40: 'text-[clamp(32px,2.78vw,40px)]',
  44: 'text-[clamp(32px,3.06vw,44px)]',
  48: 'text-[clamp(32px,3.33vw,48px)]',
  56: 'text-[clamp(32px,3.89vw,56px)]',
  64: 'text-[clamp(32px,4.44vw,64px)]',
};

/** Cormorant heading block with optional eyebrow, description and action. */
export function SectionHeading({
  title,
  eyebrow,
  description,
  action,
  as: H = 'h2',
  size = 44,
  className,
}: SectionHeadingProps) {
  const ref = useRef<HTMLHeadingElement>(null);
  const known = HEADING[size];
  useElementStyle(
    ref,
    known ? undefined : {fontSize: `clamp(${Math.min(size, 32)}px, ${(size / 14.4).toFixed(2)}vw, ${size}px)`}
  );
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-x-12 gap-y-6', className)}>
      <div className="flex min-w-0 flex-col gap-4">
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <H ref={ref} className={cn('m-0 font-display font-normal leading-tight tracking-display', known)}>
          {title}
        </H>
        {description && <p className="m-0 max-w-[52ch] text-[15px] leading-body text-text-secondary">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
