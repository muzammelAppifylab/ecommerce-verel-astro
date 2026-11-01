import type {ComponentProps, ReactNode} from 'react';

import {Button as UIButton, buttonVariants} from '@/components/ui/button';
import {cn} from '@/lib/utils';

import {Spinner} from './Spinner';

export type ButtonVariant = 'solid' | 'outline' | 'quiet' | 'inverse';
export type ButtonSize = 'sm' | 'md' | 'lg';

export {buttonVariants};

/** Class string for any element that should look like a VAREL button (cva, see ui/button). */
export function buttonClasses({
  variant = 'solid',
  size = 'md',
  fullWidth = false,
  disabled = false,
  className,
}: {variant?: ButtonVariant; size?: ButtonSize; fullWidth?: boolean; disabled?: boolean; className?: string} = {}) {
  return cn(buttonVariants({variant, size, fullWidth}), disabled && 'pointer-events-none opacity-34', className);
}

type Common = {
  /** solid = obsidian fill; outline = hairline that inverts on hover; quiet = underlined text; inverse = white on dark */
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  disabled?: boolean;
  /** Shows a spinner, sets aria-busy and disables the button (AGENTS.md "Buttons and forms") */
  loading?: boolean;
  /** Label while `loading` ("Saving…"); the children stay when omitted */
  loadingLabel?: ReactNode;
  children?: ReactNode;
  className?: string;
};

export type ButtonProps = Common &
  (
    | ({as?: 'button'; href?: undefined; to?: undefined} & Omit<ComponentProps<'button'>, keyof Common>)
    /** A link styled as a button. `to` is kept from VAREL's router API and means the same as `href`. */
    | ({as?: 'a'; href: string; to?: undefined} & Omit<ComponentProps<'a'>, keyof Common>)
    | ({as?: 'a'; to: string; href?: undefined} & Omit<ComponentProps<'a'>, keyof Common | 'href'>)
  );

/** Primary action control, built on ui/button (cva). Squared, uppercase tracked label. One `solid` per view.
 *  Links are plain <a href> (Astro pages; the ClientRouter makes them instant). */
export function Button(props: ButtonProps) {
  const {
    variant = 'solid',
    size = 'md',
    fullWidth = false,
    disabled = false,
    loading = false,
    loadingLabel,
    children,
    className,
    ...rest
  } = props;
  const off = disabled || loading;
  const content = (
    <>
      {loading && <Spinner size={14} />}
      {loading && loadingLabel !== undefined ? loadingLabel : children}
    </>
  );
  const ui = {variant, size, fullWidth, className} as const;

  const target = (rest as {href?: string}).href ?? (rest as {to?: string}).to;
  if (target !== undefined || rest.as === 'a') {
    const {as: _as, to: _to, href: _href, ...aRest} = rest as {as?: 'a'; to?: string; href?: string} & ComponentProps<'a'>;
    void _as;
    void _to;
    void _href;
    return (
      <UIButton asChild {...ui}>
        <a
          href={off ? undefined : target}
          aria-disabled={off || undefined}
          aria-busy={loading || undefined}
          tabIndex={off ? -1 : undefined}
          {...aRest}>
          {content}
        </a>
      </UIButton>
    );
  }
  const {as: _as, type = 'button', ...bRest} = rest as {as?: 'button'} & ComponentProps<'button'>;
  void _as;
  return (
    <UIButton type={type} disabled={off} aria-busy={loading || undefined} {...ui} {...bRest}>
      {content}
    </UIButton>
  );
}
