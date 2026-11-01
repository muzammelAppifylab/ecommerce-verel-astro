import {type CSSProperties, type RefObject, useEffect, useLayoutEffect} from 'react';

/*
 * The site's CSP forbids style="" attributes, and React writes the `style` prop as an attribute in
 * server-rendered HTML. Values a class cannot express (a computed width, a hex from the API) are applied
 * here instead, through element.style after hydration (CSSOM, which the CSP allows). Static values belong
 * in classes; this is the exception, never the habit.
 */
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

const toKebab = (prop: string) => (prop.startsWith('--') ? prop : prop.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`));
const toValue = (prop: string, value: unknown) =>
  typeof value === 'number' && !UNITLESS.has(prop) ? `${value}px` : String(value);
const UNITLESS = new Set(['opacity', 'zIndex', 'flexGrow', 'flexShrink', 'order', 'lineHeight', 'fontWeight', 'scale']);

/** Apply `style` to `ref.current` through the CSSOM, and remove what a previous render set. */
export function useElementStyle(ref: RefObject<HTMLElement | SVGElement | null>, style: CSSProperties | undefined): void {
  const key = style ? JSON.stringify(style) : '';
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el || !style) return;
    const entries = Object.entries(style).filter(([, v]) => v !== undefined && v !== null && v !== '');
    for (const [prop, value] of entries) el.style.setProperty(toKebab(prop), toValue(prop, value));
    return () => {
      for (const [prop] of entries) el.style.removeProperty(toKebab(prop));
    };
    // `key` stands for `style` (a new object every render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, key]);
}
