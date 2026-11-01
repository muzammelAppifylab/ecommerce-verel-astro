import {useEffect, useRef, useState} from 'react';

import {money, useText} from '@/components/varel';

export interface PriceSliderProps {
  /** Ceiling of the range (base set price max, rounded to the step) */
  max: number;
  /** Current maximum price filter; undefined = no limit (thumb at max) */
  value: number | undefined;
  /** Commit (debounced while dragging). undefined clears the filter. */
  onChange: (v: number | undefined) => void;
  step?: number;
}

/** "Price" fieldset from the Shop filter rail: native range, "Up to $400" (port of VAREL PriceSlider). */
export function PriceSlider({max, value, onChange, step = 5}: PriceSliderProps) {
  const t = useText('catalog');
  const current = value === undefined ? max : Math.min(value, max);
  const [local, setLocal] = useState(current);
  const timer = useRef<number | undefined>(undefined);

  // Follow external changes (clear filters, back/forward).
  useEffect(() => setLocal(current), [current]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const commit = (v: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => onChange(v >= max ? undefined : v), 250);
  };

  return (
    <fieldset className="m-0 flex flex-col gap-3.5 border-0 border-t border-hairline px-0 pt-5 pb-0">
      <legend className="float-left w-full p-0 text-label-sm tracking-label text-text-muted uppercase">{t('filters.price')}</legend>
      <input
        type="range"
        min={0}
        max={max}
        step={step}
        value={local}
        onChange={e => {
          const v = Number(e.target.value);
          setLocal(v);
          commit(v);
        }}
        aria-label={t('filters.maxPrice')}
        aria-valuetext={t('filters.upTo', {price: money(local)})}
        className="w-full accent-ink-900"
      />
      <span className="text-[13px] text-text-secondary">{t('filters.upTo', {price: money(local)})}</span>
    </fieldset>
  );
}
