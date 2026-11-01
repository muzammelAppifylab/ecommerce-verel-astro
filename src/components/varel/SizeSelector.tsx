import {cn} from '@/lib/utils';

import {useText} from './text';

export interface SizeSelectorProps {
  sizes?: string[];
  value?: string | null;
  /** Sizes rendered struck-through and disabled */
  soldOut?: string[];
  onChange?: (size: string) => void;
  className?: string;
  /** aria-label for the group, default product:buy.size ("Size") */
  label?: string;
}

/** Size variant picker; sold-out sizes stay visible and struck through. */
export function SizeSelector({sizes = ['XS', 'S', 'M', 'L', 'XL'], value, soldOut = [], onChange, className, label}: SizeSelectorProps) {
  const t = useText('product');
  return (
    <div role="group" aria-label={label ?? t('buy.size')} className={cn('flex flex-wrap gap-2', className)}>
      {sizes.map(s => {
        const out = soldOut.includes(s);
        const on = s === value;
        return (
          <button
            key={s}
            type="button"
            disabled={out}
            aria-pressed={on}
            aria-label={out ? t('buy.sizeSoldOut', {size: s}) : s}
            onClick={() => onChange?.(s)}
            className={cn(
              'h-11 min-w-[52px] rounded-none border px-3 font-sans text-label-md tracking-wide transition-hover',
              on ? 'border-strong bg-ink-900 text-ink-000' : 'border-hairline bg-transparent text-text-primary hover:border-strong',
              out && 'cursor-not-allowed text-text-disabled line-through hover:border-hairline'
            )}>
            {s}
          </button>
        );
      })}
    </div>
  );
}
