import {useCallback, useEffect, useRef, useState} from 'react';

/** Flips true for `ms` after `flash()`: the prototype's "Added to bag" label (VAREL Wishlist.tsx `useFlash`). */
export function useFlash(ms: number) {
  const [on, setOn] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const flash = useCallback(() => {
    setOn(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOn(false), ms);
  }, [ms]);
  return [on, flash] as const;
}
