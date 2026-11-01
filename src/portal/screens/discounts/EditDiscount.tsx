import {useQuery} from '@tanstack/react-query';
import {Link, useNavigate, useParams, useSearch} from '@tanstack/react-router';

import {ApiError} from '../../api';
import {discountQuery} from '../../queries/discounts';
import {Button, Card, ErrorNote, Icon, PageHeader, Skeleton} from '../../ui';
import {DiscountEditor} from './DiscountEditor';
import {formFromDiscount} from './helpers';

/** `/dashboard/discounts/$id`: settings, codes (unique-code discounts) and report. */
export function EditDiscount() {
  const {id} = useParams({from: '/discounts/$id'});
  const {tab} = useSearch({from: '/discounts/$id'});
  const discount = useQuery(discountQuery(id));

  if (discount.data)
    return <DiscountEditor key={discount.data.id} discount={discount.data} initial={formFromDiscount(discount.data)} tab={tab ?? 'settings'} />;
  if (discount.isError) return <Missing error={discount.error} onRetry={() => void discount.refetch()} />;
  return <EditorSkeleton />;
}

/** "← Discounts" above the page header (the kit's `PageHeader` has no back slot). */
export function BackLink() {
  return (
    <Link to="/discounts" className="discount-back">
      <Icon name="arrow-left" size={14} />
      Discounts
    </Link>
  );
}

export function Missing({error, onRetry}: {error: Error; onRetry: () => void}) {
  const navigate = useNavigate();
  const notFound = error instanceof ApiError && error.status === 404;
  return (
    <div className="app-page discount-screen">
      <BackLink />
      <PageHeader title={notFound ? 'Discount not found' : 'Discount'} />
      {notFound ? (
        <Card>
          <div className="discount-missing">
            <p className="muted">It may have been deleted, or the link is out of date.</p>
            <Button variant="secondary" size="sm" onClick={() => void navigate({to: '/discounts'})}>
              Back to discounts
            </Button>
          </div>
        </Card>
      ) : (
        <div className="discount-load-error">
          <ErrorNote error={error} title="This discount could not be loaded" />
          <Button variant="secondary" size="sm" icon="refresh" onClick={onRetry}>
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}

export function EditorSkeleton() {
  return (
    <div className="app-page discount-screen" aria-busy="true" aria-label="Loading discount">
      <div className="discount-skeleton-head">
        <Skeleton width="third" />
        <Skeleton width="half" />
        <Skeleton width="third" />
      </div>
      <div className="discount-editor-grid">
        <div className="discount-editor-main">
          {[4, 3, 3, 2].map((lines, i) => (
            <Card key={i}>
              <Skeleton width="third" />
              <Skeleton lines={lines} />
            </Card>
          ))}
        </div>
        <div className="discount-editor-side">
          {[3, 4].map((lines, i) => (
            <Card key={i}>
              <Skeleton width="third" />
              <Skeleton lines={lines} />
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
