/*
 * CSP-safe stand-in for `react-remove-scroll` (used by Radix Dialog, Sheet, Select and modal DropdownMenu).
 *
 * The real package locks page scroll by injecting a <style> element (react-style-singleton). The site's
 * CSP (astro.config.mjs `security.csp`) only allows hashed styles, so that element is refused and every
 * open dialog logs a CSP violation. This shim keeps the same API and locks scroll through element.style
 * (CSSOM, which the CSP allows): `overflow: hidden` on <html> plus a right padding equal to the scrollbar
 * it removes, reference-counted so nested locks (a select inside a sheet) release in order.
 *
 * Wired with a Vite alias in astro.config.mjs (requested from F3, docs/migration/handoff/F2.md):
 *   vite: {resolve: {alias: {'react-remove-scroll': '/src/components/ui/remove-scroll.tsx'}}}
 */
import * as React from 'react';

interface RemoveScrollProps {
  children?: React.ReactNode;
  /** Switches the lock on and off (Radix passes `enabled` while a modal layer is open). */
  enabled?: boolean;
  /** Render the lock as this element; Radix passes its Slot so no wrapper is added. */
  as?: React.ElementType;
  /** Accepted for API compatibility; the shim never blocks pinch zoom or wheel events inside the layer. */
  allowPinchZoom?: boolean;
  shards?: Array<React.RefObject<unknown> | HTMLElement>;
  removeScrollBar?: boolean;
  noIsolation?: boolean;
  noRelative?: boolean;
  inert?: boolean;
  forwardProps?: boolean;
  gapMode?: 'padding' | 'margin';
  className?: string;
  style?: React.CSSProperties;
  [prop: string]: unknown;
}

let locks = 0;
let saved: {overflow: string; paddingRight: string} | null = null;

function lock() {
  if (typeof document === 'undefined') return;
  locks += 1;
  if (locks > 1) return;
  const root = document.documentElement;
  const gap = window.innerWidth - root.clientWidth;
  saved = {overflow: root.style.overflow, paddingRight: root.style.paddingRight};
  root.style.overflow = 'hidden';
  if (gap > 0) root.style.paddingRight = `${gap}px`;
}

function unlock() {
  if (typeof document === 'undefined' || locks === 0) return;
  locks -= 1;
  if (locks > 0 || !saved) return;
  const root = document.documentElement;
  root.style.overflow = saved.overflow;
  root.style.paddingRight = saved.paddingRight;
  saved = null;
}

const SKIP = new Set([
  'children',
  'enabled',
  'as',
  'allowPinchZoom',
  'shards',
  'removeScrollBar',
  'noIsolation',
  'noRelative',
  'inert',
  'forwardProps',
  'gapMode',
  'sideCar',
]);

const RemoveScrollImpl = React.forwardRef<HTMLElement, RemoveScrollProps>(function RemoveScroll(props, ref) {
  const {children, enabled = true, forwardProps} = props;
  const Container = (props.as ?? 'div') as React.ElementType;
  React.useEffect(() => {
    if (!enabled) return;
    lock();
    return unlock;
  }, [enabled]);
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) if (!SKIP.has(key)) rest[key] = value;
  if (forwardProps && React.isValidElement(children)) {
    return React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {...rest, ref});
  }
  return (
    <Container ref={ref} {...rest}>
      {children}
    </Container>
  );
});

type RemoveScrollType = typeof RemoveScrollImpl & {classNames: {fullWidth: string; zeroRight: string}};

/** Same export shape as the package: `import {RemoveScroll} from 'react-remove-scroll'` and the default. */
export const RemoveScroll = RemoveScrollImpl as RemoveScrollType;
RemoveScroll.classNames = {fullWidth: 'width-before-scroll-bar', zeroRight: 'right-scroll-bar-position'};

export default RemoveScroll;
