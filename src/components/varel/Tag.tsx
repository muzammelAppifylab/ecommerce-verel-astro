import type {ComponentProps} from 'react';

import {cn} from '@/lib/utils';

import {Icon} from './Icon';
import {useText} from './text';

export interface TagProps extends Omit<ComponentProps<'button'>, 'onClick'> {
  selected?: boolean;
  /** Shows an × and makes the whole chip call onRemove */
  removable?: boolean;
  onRemove?: () => void;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
}

/** Filter chip / applied-refinement pill used across collection pages. */
export function Tag({selected = false, removable = false, onRemove, onClick, className, children, ...rest}: TagProps) {
  const t = useText('layout');
  return (
    <button
      type="button"
      aria-pressed={removable ? undefined : selected}
      aria-label={removable && typeof children === 'string' ? t('ui.removeTag', {name: children}) : undefined}
      onClick={e => {
        onClick?.(e);
        if (removable) onRemove?.();
      }}
      className={cn(
        'inline-flex h-8 items-center gap-2 rounded-none border px-3 font-sans text-label-md tracking-wide uppercase transition-hover active:opacity-48',
        selected
          ? 'border-strong bg-ink-900 text-ink-000'
          : 'border-hairline bg-transparent text-text-primary hover:bg-ink-050',
        className
      )}
      {...rest}>
      {children}
      {removable && <Icon name="x" size={12} className="opacity-70" />}
    </button>
  );
}
