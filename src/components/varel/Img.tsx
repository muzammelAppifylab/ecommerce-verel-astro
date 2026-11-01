import {type Photo, photoSrcSet, photoUrl} from './support';
import {cn} from '@/lib/utils';

export type ImgRatio = '3/4' | '4/5' | '16/9' | 'fill';

const RATIO: Record<Exclude<ImgRatio, 'fill'>, string> = {
  '3/4': 'aspect-[3/4]',
  '4/5': 'aspect-[4/5]',
  '16/9': 'aspect-[16/9]',
};

export interface ImgProps {
  /** API photo ({src, credit, creditHref}); the Unsplash URL is built with `width`. Credits are not shown on the photo. */
  photo?: Photo | null;
  /** Raw URL instead of a photo (used as-is) */
  src?: string;
  alt?: string;
  /** 3/4 product · 4/5 editorial · 16/9 banner · fill = absolutely fills its positioned parent. Never square. */
  ratio?: ImgRatio;
  /** Requested pixel width (default 1000). A srcSet is generated around it. */
  width?: number;
  /** `sizes` attribute for the srcSet, e.g. "(min-width: 1024px) 33vw, 50vw" */
  sizes?: string;
  /** Apply the VAREL matte grade (saturate .32, contrast 1.03). Default true. */
  grade?: boolean;
  /** Mark the <img> as the hover-scaling media inside a [data-card] (default true) */
  media?: boolean;
  /** Eager-load (hero images) */
  priority?: boolean;
  className?: string;
  imgClassName?: string;
}

/** Fixed-ratio image frame on chalk ground with the VAREL grade. */
export function Img({
  photo,
  src,
  alt = '',
  ratio = '3/4',
  width = 1000,
  sizes,
  grade = true,
  media = true,
  priority = false,
  className,
  imgClassName,
}: ImgProps) {
  const url = src ?? (photo ? photoUrl(photo, width) : '');
  const srcSet = !src && photo ? photoSrcSet(photo, [Math.round(width / 2), width, Math.round(width * 1.6)]) : undefined;
  return (
    <div
      className={cn(
        'overflow-hidden bg-chalk',
        ratio === 'fill' ? 'absolute inset-0' : cn('relative w-full', RATIO[ratio]),
        className
      )}>
      {url && (
        <img
          src={url}
          srcSet={srcSet}
          sizes={srcSet ? (sizes ?? `${width}px`) : undefined}
          alt={alt}
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : undefined}
          decoding="async"
          data-media={media ? 'true' : undefined}
          className={cn('absolute inset-0 h-full w-full object-cover', grade && 'img-grade', imgClassName)}
        />
      )}
    </div>
  );
}
