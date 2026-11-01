import {type ReactNode, type RefObject, useEffect, useId, useLayoutEffect, useRef} from 'react';

/**
 * A floating panel anchored to a trigger: the date range picker, the rich
 * text editor's colour and link panels. Not a menu (that is `Menu`) and not a
 * dialog (`Modal`): it holds a few controls, closes on Esc, on a click
 * outside, on scroll and on resize, and gives focus back to its trigger.
 *
 * Positioned `fixed` from the anchor through the CSSOM (`element.style`), which
 * the CSP allows; never a `style=""` attribute.
 */
export function Popover({
  open,
  onClose,
  anchor,
  label,
  align = 'start',
  children,
  className,
  focusFirst = true,
  returnFocus = true,
}: {
  open: boolean;
  onClose: () => void;
  /** The element the panel hangs from (usually its trigger button). */
  anchor: RefObject<HTMLElement | null>;
  /** What the panel is for, for screen readers ("Pick dates"). */
  label: string;
  align?: 'start' | 'end';
  children: ReactNode;
  className?: string;
  /** Move focus into the panel when it opens (off for the editor's panels, which keep the text selection). */
  focusFirst?: boolean;
  /** Give focus back to the anchor when the panel closes with Esc. */
  returnFocus?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();

  useLayoutEffect(() => {
    if (!open || !anchor.current || !panel.current) return;
    const place = () => {
      const rect = anchor.current!.getBoundingClientRect();
      const node = panel.current!;
      const below = window.innerHeight - rect.bottom > node.offsetHeight + 12 || rect.top < node.offsetHeight + 12;
      node.style.top = `${Math.max(8, below ? rect.bottom + 6 : rect.top - node.offsetHeight - 6)}px`;
      const left = align === 'end' ? rect.right - node.offsetWidth : rect.left;
      node.style.left = `${Math.max(8, Math.min(left, window.innerWidth - node.offsetWidth - 8))}px`;
    };
    place();
    if (focusFirst) {
      panel.current.querySelector<HTMLElement>('input, button:not(:disabled), [tabindex="0"]')?.focus();
    }
    const observer = new ResizeObserver(place);
    observer.observe(panel.current);
    return () => observer.disconnect();
  }, [open, anchor, align, focusFirst]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !anchor.current?.contains(target)) onClose();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
      if (returnFocus) anchor.current?.focus();
    };
    const away = (event: Event) => {
      if (event.target instanceof Node && panel.current?.contains(event.target)) return;
      onClose();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key, true);
    window.addEventListener('resize', away);
    window.addEventListener('scroll', away, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('resize', away);
      window.removeEventListener('scroll', away, true);
    };
  }, [open, onClose, anchor, returnFocus]);

  if (!open) return null;
  return (
    <div ref={panel} id={id} role="dialog" aria-label={label} className={['popover', className].filter(Boolean).join(' ')}>
      {children}
    </div>
  );
}
