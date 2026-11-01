import {cn} from '@/lib/utils';

import {Icon} from './Icon';
import {useText} from './text';

export interface QuantityStepperProps {
  value?: number;
  min?: number;
  max?: number;
  onChange?: (value: number) => void;
  disabled?: boolean;
  className?: string;
  /** Used in aria-labels: "Decrease quantity of Forma Overshirt" */
  itemLabel?: string;
}

/** Line-item quantity control in the bag. */
export function QuantityStepper({value = 1, min = 1, max = 9, onChange, disabled = false, className, itemLabel}: QuantityStepperProps) {
  const t = useText('layout');
  const step = (d: number) => onChange?.(Math.min(max, Math.max(min, value + d)));
  const btn =
    'inline-flex size-[34px] items-center justify-center border-0 bg-transparent p-0 text-ink-900 transition-hover hover:text-ink-500 disabled:cursor-not-allowed disabled:opacity-30';
  return (
    <div className={cn('inline-flex items-center border border-hairline', disabled && 'opacity-40', className)}>
      <button
        type="button"
        aria-label={itemLabel ? t('ui.decreaseOf', {name: itemLabel}) : t('ui.decrease')}
        disabled={disabled || value <= min}
        onClick={() => step(-1)}
        className={btn}>
        <Icon name="minus" size={13} />
      </button>
      <span aria-live="polite" className="min-w-[26px] text-center text-body-sm">
        {value}
      </span>
      <button
        type="button"
        aria-label={itemLabel ? t('ui.increaseOf', {name: itemLabel}) : t('ui.increase')}
        disabled={disabled || value >= max}
        onClick={() => step(1)}
        className={btn}>
        <Icon name="plus" size={13} />
      </button>
    </div>
  );
}
