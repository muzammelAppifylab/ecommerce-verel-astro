import {Skeleton} from '@/components/varel';

export const STAGES = ['received', 'processing', 'packed', 'shipped', 'delivered'] as const;

/** Order details while loading (VAREL shapes). */
export function DetailsSkeleton() {
  return (
    <div aria-busy="true">
      <div className="flex flex-col gap-3 pb-10">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-12 w-96 max-w-full" />
        <Skeleton className="h-7 w-48" />
      </div>
      <div className="grid grid-cols-2 gap-0.5 py-12 sm:grid-cols-5">
        {STAGES.map(s => (
          <Skeleton key={s} className="h-20" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-12 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Skeleton className="h-80" />
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}
