import {Skeleton as UISkeleton} from '@/components/ui/skeleton';
import {cn} from '@/lib/utils';

/** Flat chalk block that breathes slowly (ui/skeleton). No shimmer, no rounding. Size it with classes. */
export function Skeleton({className}: {className?: string}) {
  return <UISkeleton className={className} />;
}

/** Lines of text placeholder. */
export function TextSkeleton({lines = 3, className}: {lines?: number; className?: string}) {
  return (
    <div className={cn('flex flex-col gap-2.5', className)} aria-hidden="true">
      {Array.from({length: lines}, (_, i) => (
        <UISkeleton key={i} className={cn('h-3.5', i === lines - 1 ? 'w-3/5' : 'w-full')} />
      ))}
    </div>
  );
}
