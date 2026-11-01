import {useRef} from 'react';

import {cn} from '@/lib/utils';

import {useElementStyle} from './element-style';
import {Img} from './Img';
import {type Photo, SWATCH} from './support';

export interface ProductMediaProps {
  src?: string;
  alt?: string;
  /** Placeholder tint keyed to a colourway: Black | Stone | Olive | Navy (any SWATCH name) */
  tone?: string;
  /** CSS aspect-ratio, default "3 / 4" */
  ratio?: string;
  /** Placeholder caption */
  caption?: string;
  /** API photo (extension): takes precedence over the placeholder */
  photo?: Photo | null;
  width?: number;
  className?: string;
}

const RATIO: Record<string, string> = {
  '3 / 4': 'aspect-[3/4]',
  '4 / 5': 'aspect-[4/5]',
  '16 / 9': 'aspect-[16/9]',
};

/** Fixed-ratio frame for product imagery; tonal placeholder until a src/photo is supplied. */
export function ProductMedia({src, alt, tone = 'Stone', ratio = '3 / 4', caption, photo, width, className}: ProductMediaProps) {
  const frame = useRef<HTMLDivElement>(null);
  const tint = useRef<HTMLDivElement>(null);
  const known = RATIO[ratio];
  useElementStyle(frame, known ? undefined : {aspectRatio: ratio});
  const hasMedia = Boolean(src || photo);
  // The tone is a hex from SWATCH (or any CSS colour): painted after hydration, chalk until then.
  useElementStyle(tint, hasMedia ? undefined : {background: SWATCH[tone] ?? 'var(--ink-050)'});
  return (
    <div ref={frame} className={cn('relative w-full overflow-hidden bg-ink-050', known, className)}>
      {hasMedia ? (
        <Img photo={photo} src={src} alt={alt} ratio="fill" width={width} />
      ) : (
        <div ref={tint} className="absolute inset-0 flex items-end bg-ink-050 p-4 opacity-34">
          <span className="font-sans text-label-sm tracking-label text-ink-700 uppercase opacity-70">{caption || 'Image'}</span>
        </div>
      )}
    </div>
  );
}
