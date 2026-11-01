import {useQuery} from '@tanstack/react-query';
import {useSearch} from '@tanstack/react-router';

import {discountQuery} from '../../queries/discounts';
import {DiscountEditor} from './DiscountEditor';
import {EditorSkeleton, Missing} from './EditDiscount';
import {duplicateForm, presetForm} from './helpers';

/** New discount, preset by kind (`?type=`) or copied from another (`?from=`). */
export function NewDiscount() {
  const {type, from} = useSearch({from: '/discounts/new'});
  const source = useQuery({...discountQuery(from ?? ''), enabled: !!from});

  if (from) {
    if (source.data)
      return (
        <DiscountEditor key={`from-${from}`} initial={duplicateForm(source.data)} duplicateOf={source.data.name || source.data.code || 'discount'} />
      );
    if (source.isError) return <Missing error={source.error} onRetry={() => void source.refetch()} />;
    return <EditorSkeleton />;
  }
  return <DiscountEditor key={type ?? 'order'} initial={presetForm(type)} />;
}
