import {clsx, type ClassValue} from 'clsx';
import {extendTailwindMerge} from 'tailwind-merge';

/* tailwind-merge must know VAREL's custom theme keys, otherwise e.g.
   `text-label-sm` (font size) and `text-ink-500` (colour) would be treated
   as the same group and one of them dropped. Ported from VAREL `src/lib/utils.ts`. */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: [
        'display-1',
        'display-2',
        'display-3',
        'display-4',
        'display-5',
        'body-lg',
        'body-md',
        'body-sm',
        'body-xs',
        'label-lg',
        'label-md',
        'label-sm',
      ],
      tracking: ['display', 'wide', 'label', 'loose', 'wordmark'],
      leading: ['tight', 'display', 'snug', 'body', 'loose'],
      shadow: ['lift', 'overlay', 'drawer'],
      ease: ['standard', 'out', 'in'],
      container: ['page', 'editorial', 'measure'],
      blur: ['veil', 'glass'],
      font: ['display', 'sans', 'body', 'mono'],
      'font-weight': ['light', 'regular'],
    },
  },
});

/** Join class names and resolve Tailwind conflicts (storefront components). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
