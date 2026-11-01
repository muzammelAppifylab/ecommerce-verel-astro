import {useRef} from 'react';

import {cn} from '@/lib/utils';

import {useElementStyle} from './element-style';
import {SWATCH} from './support';

export interface ColorSwatchProps {
  /** Colourway name (Black | Stone | Olive | Navy | Chalk …) or any CSS colour */
  color: string;
  label?: string;
  size?: number;
  selected?: boolean;
  onClick?: () => void;
  className?: string;
}

/* Dot and hit-box sizes as classes for the sizes VAREL uses (the box is the dot + 8px). */
const DOT: Record<number, string> = {12: 'size-[12px]', 13: 'size-[13px]', 16: 'size-[16px]', 18: 'size-[18px]'};
const BOX: Record<number, string> = {12: 'size-[20px]', 13: 'size-[21px]', 16: 'size-[24px]', 18: 'size-[26px]'};

/** Circular colourway dot. Selection is a hairline ring, never a checkmark. 12–13px on tiles, 18px on the PDP.
 *  The colour (a hex from the API) is painted after hydration through element.style (the CSP forbids style=""). */
export function ColorSwatch({color, label, size = 16, selected = false, onClick, className}: ColorSwatchProps) {
  const hex = SWATCH[color] ?? color;
  const name = label || color;
  const dotRef = useRef<HTMLSpanElement>(null);
  const boxRef = useRef<HTMLElement>(null);
  const known = DOT[size];
  useElementStyle(dotRef, known ? {background: hex} : {background: hex, width: size, height: size});
  useElementStyle(boxRef, known ? undefined : {width: size + 8, height: size + 8});
  const cls = cn(
    'inline-flex shrink-0 items-center justify-center rounded-full border-0 bg-transparent p-0 transition-hover',
    BOX[size],
    selected && 'shadow-[inset_0_0_0_1px_var(--border-strong)]',
    onClick ? 'cursor-pointer' : 'cursor-default',
    className
  );
  const dot = <span ref={dotRef} className={cn('rounded-full bg-ink-100 shadow-[inset_0_0_0_1px_rgba(26,26,26,.14)]', known)} />;
  if (onClick) {
    return (
      <button
        ref={boxRef as React.RefObject<HTMLButtonElement>}
        type="button"
        onClick={onClick}
        title={name}
        aria-label={name}
        aria-pressed={selected}
        className={cls}>
        {dot}
      </button>
    );
  }
  return (
    <span ref={boxRef as React.RefObject<HTMLSpanElement>} title={name} aria-label={name} role="img" className={cls}>
      {dot}
    </span>
  );
}
