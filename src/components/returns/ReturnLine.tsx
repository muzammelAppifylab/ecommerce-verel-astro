import {Checkbox, Img, Input, Select} from '@/components/varel';
import {dotJoin, money} from '@/lib/format';
import type {TFunction} from '@/lib/i18n';
import {productLink} from '@/lib/links';
import type {OrderItem} from '@/lib/types/orders';
import {cn} from '@/lib/utils';

export interface LinePick {
  on: boolean;
  qty: number;
  reason: string;
}

/** One returnable piece: choose it, how many, and why (VAREL policy/ReturnRequest.tsx ReturnLine). */
export function ReturnLine({
  item,
  pick,
  error,
  currency,
  locale,
  reasons,
  t,
  onChange,
}: {
  item: OrderItem;
  pick: LinePick;
  error?: string;
  currency?: string;
  locale: string;
  /** Setting.returnReasons: a fixed list when the studio set one, otherwise a free-text reason. */
  reasons: string[];
  t: TFunction;
  onChange: (patch: Partial<LinePick>) => void;
}) {
  const fieldId = `ret-line-${item.lineId}`;
  const image = <Img photo={item.image} alt="" ratio="3/4" width={240} sizes="88px" />;
  return (
    <li className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-5 gap-y-4 border-b border-hairline py-5 md:grid-cols-[88px_minmax(0,1fr)_minmax(0,1fr)] md:gap-x-8">
      {item.productId ? (
        <a href={productLink(item.productId, locale)} className="border-0" aria-label={item.name}>
          {image}
        </a>
      ) : (
        <span>{image}</span>
      )}
      <div className="flex min-w-0 flex-col gap-2">
        <Checkbox
          id={`${fieldId}-on`}
          checked={pick.on}
          onCheckedChange={on => onChange({on})}
          label={<span className="font-display text-[19px] leading-display">{item.name}</span>}
        />
        <span className="text-body-xs text-text-muted">
          {dotJoin(item.color, item.size, ...Object.values(item.options ?? {}), t('request.qty', {qty: item.qty}))}
        </span>
        <span className="text-body-sm">{money(item.price, currency, locale)}</span>
      </div>
      <div
        className={cn('col-span-2 flex flex-col gap-4 transition-hover md:col-span-1', !pick.on && 'pointer-events-none opacity-40')}
        aria-hidden={!pick.on || undefined}>
        {item.qty > 1 && (
          <Select
            label={t('request.quantity')}
            value={String(pick.qty)}
            options={Array.from({length: item.qty}, (_, i) => String(i + 1))}
            onValueChange={v => onChange({qty: Number(v)})}
            disabled={!pick.on}
          />
        )}
        {reasons.length ? (
          <Select
            id={`${fieldId}-reason`}
            label={t('request.reason')}
            value={pick.reason}
            options={reasons}
            placeholder={t('request.chooseReason')}
            onValueChange={reason => onChange({reason})}
            disabled={!pick.on}
            error={pick.on ? (error ?? null) : null}
          />
        ) : (
          <Input
            id={`${fieldId}-reason`}
            label={t('request.reason')}
            value={pick.reason}
            onChange={e => onChange({reason: e.target.value})}
            placeholder={t('request.reasonPlaceholder')}
            maxLength={300}
            disabled={!pick.on}
            error={pick.on ? (error ?? null) : null}
          />
        )}
      </div>
    </li>
  );
}
