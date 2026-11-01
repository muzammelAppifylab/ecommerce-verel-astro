import {type ComponentProps, useRef} from 'react';

import {cn} from '@/lib/utils';

import {useElementStyle} from './element-style';
import {Icon, type IconName} from './Icon';
import {PX_SIZE} from './support';

export type IconButtonVariant = 'quiet' | 'outline' | 'solid';

const SKINS: Record<IconButtonVariant, string> = {
  quiet: 'bg-transparent border-0 text-ink-900 hover:text-ink-500',
  outline: 'bg-transparent border border-strong text-ink-900 hover:bg-ink-900 hover:text-ink-000',
  solid: 'bg-ink-900 border-0 text-ink-000 hover:bg-ink-700',
};

export interface IconButtonProps extends Omit<ComponentProps<'button'>, 'children' | 'style'> {
  /** Lucide icon name, e.g. "search" | "shopping-bag" | "x" */
  name: IconName;
  /** Required accessible label */
  label: string;
  /** Box size in px; the glyph is 45% of it */
  size?: number;
  variant?: IconButtonVariant;
  disabled?: boolean;
  /** Override the glyph size (default round(size × 0.45)) */
  iconSize?: number;
}

/** Square, label-less control for utility actions (search, bag, close, wishlist). */
export function IconButton({
  name,
  label,
  size = 40,
  variant = 'quiet',
  disabled = false,
  iconSize,
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const known = PX_SIZE[size];
  useElementStyle(ref, known ? undefined : {width: size, height: size});
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={rest.title}
      disabled={disabled}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-none p-0 transition-hover active:opacity-48',
        'disabled:cursor-not-allowed disabled:opacity-34',
        known,
        SKINS[variant],
        className
      )}
      {...rest}>
      <Icon name={name} size={iconSize ?? Math.round(size * 0.45)} />
    </button>
  );
}
