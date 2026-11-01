import {type ReactNode, useRef} from 'react';

import {Dialog as UIDialog, DialogContent, DialogDescription, DialogTitle} from '@/components/ui/dialog';
import {Sheet, SheetContent, SheetDescription, SheetTitle} from '@/components/ui/sheet';
import {cn} from '@/lib/utils';

import {useElementStyle} from './element-style';
import {useText} from './text';

export interface DialogProps {
  open?: boolean;
  title?: string;
  /** center = modal on ui/dialog (fades, no scale); right = full-height drawer on ui/sheet (slides 400ms) */
  placement?: 'center' | 'right';
  width?: number;
  footer?: ReactNode;
  children?: ReactNode;
  onClose?: () => void;
  /** Optional visually hidden description for screen readers */
  description?: string;
  className?: string;
  /** Classes for the scrolling body */
  bodyClassName?: string;
}

/* The widths VAREL uses, as classes (the CSP forbids style=""); others are applied through element.style. */
const CENTER_W: Record<number, string> = {
  460: 'w-[min(92vw,460px)]',
  480: 'w-[min(92vw,480px)]',
  520: 'w-[min(92vw,520px)]',
  600: 'w-[min(92vw,600px)]',
  760: 'w-[min(92vw,760px)]',
};
const RIGHT_W: Record<number, string> = {
  440: 'w-[min(100vw,440px)]',
  480: 'w-[min(100vw,480px)]',
  520: 'w-[min(100vw,520px)]',
  600: 'w-[min(100vw,600px)]',
};

/** Modal or right-edge drawer, built on ui/dialog and ui/sheet (Radix: focus trap, Esc, scroll lock). */
export function Dialog({
  open = false,
  title,
  placement = 'center',
  width = 520,
  footer,
  children,
  onClose,
  description,
  className,
  bodyClassName,
}: DialogProps) {
  const t = useText('common');
  const ref = useRef<HTMLDivElement>(null);
  const right = placement === 'right';
  const known = (right ? RIGHT_W : CENTER_W)[width];
  useElementStyle(ref, known || !open ? undefined : {width: right ? `min(100vw, ${width}px)` : `min(92vw, ${width}px)`});
  const onOpenChange = (o: boolean) => !o && onClose?.();

  const header = (
    Title: typeof DialogTitle | typeof SheetTitle,
    Desc: typeof DialogDescription | typeof SheetDescription
  ) => (
    <>
      <div className="flex items-start justify-between gap-6 pr-10">
        <Title className="varel-label m-0 text-text-primary">{title}</Title>
      </div>
      <Desc className="sr-only">{description ?? title}</Desc>
    </>
  );
  const body = (
    <div
      className={cn(
        'min-h-0 flex-1 overflow-auto px-8 text-body-sm leading-body max-sm:px-6',
        !footer && 'pb-8',
        bodyClassName
      )}>
      {children}
    </div>
  );
  const foot = footer && <div className="mx-8 mt-8 mb-8 border-t border-hairline pt-6 max-sm:mx-6">{footer}</div>;

  if (right) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent ref={ref} side="right" closeLabel={t('close')} className={cn('max-w-full! gap-0', known, className)}>
          <div className="px-8 pt-8 pb-6 max-sm:px-6">{header(SheetTitle, SheetDescription)}</div>
          {body}
          {foot}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <UIDialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={ref}
        closeLabel={t('close')}
        className={cn('flex max-w-none! flex-col gap-0 p-0', known, className)}>
        <div className="px-8 pt-8 pb-6 max-sm:px-6">{header(DialogTitle, DialogDescription)}</div>
        {body}
        {foot}
      </DialogContent>
    </UIDialog>
  );
}
