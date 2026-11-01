/* Class strings of the search page, verbatim from VAREL src/pages/Search.tsx. */
import {cn} from '@/lib/utils';

export const chipCls = (on = false) =>
  cn(
    'border px-4 py-[9px] text-label-sm tracking-label uppercase transition-hover',
    on
      ? 'border-strong bg-ink-900 text-ink-000 hover:text-ink-000'
      : 'border-hairline bg-transparent text-ink-900 hover:border-strong hover:text-ink-900'
  );

export const headingCls = 'm-0 font-sans text-label-sm font-light tracking-label text-text-muted uppercase';
