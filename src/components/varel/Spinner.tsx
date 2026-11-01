import {useRef} from 'react';

import {cn} from '@/lib/utils';

import {useElementStyle} from './element-style';
import {PX_SIZE} from './support';
import {useText} from './text';

export interface SpinnerProps {
  size?: number;
  className?: string;
  /** Accessible label; defaults to common:loading ("Loading") */
  label?: string;
}

/** Thin hairline ring that rotates slowly. Inherits currentColor. */
export function Spinner({size = 20, className, label}: SpinnerProps) {
  const t = useText('common');
  const ref = useRef<HTMLSpanElement>(null);
  const known = PX_SIZE[size];
  useElementStyle(ref, known ? undefined : {width: size, height: size});
  return (
    <span
      ref={ref}
      role="status"
      aria-label={label ?? t('loading')}
      className={cn(
        'inline-block shrink-0 animate-spin rounded-full border border-current border-r-transparent opacity-70 [animation-duration:900ms]',
        known,
        className
      )}
    />
  );
}
