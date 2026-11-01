/* `/dashboard/products/$id` (VAREL `EditProduct.tsx`): the editor once the product is read; a skeleton while it
   loads; "Product not found" for a 404; the error with "Try again" otherwise. */
import {useQuery} from '@tanstack/react-query';
import {Link, useParams} from '@tanstack/react-router';

import {ApiError} from '../../api';
import {productQuery} from '../../queries/products';
import {Button, buttonClass, Card, ErrorNote, Icon, LoadingBlock, PageHeader, Skeleton} from '../../ui';
import {ProductEditor} from './ProductEditor';

export function EditProduct() {
  const {id} = useParams({from: '/products/$id'});
  const product = useQuery(productQuery(id));

  if (product.data) return <ProductEditor key={product.data.id} product={product.data} />;
  if (product.isError) return <Missing error={product.error} onRetry={() => void product.refetch()} retrying={product.isFetching} />;
  return <EditorSkeleton />;
}

/** `/dashboard/products/new`. */
export function NewProduct() {
  return <ProductEditor />;
}

function BackLink() {
  return (
    <div className="editor-back">
      <Link to="/products" className={buttonClass({variant: 'link', size: 'sm'})}>
        <Icon name="arrow-left" size={16} />
        Products
      </Link>
    </div>
  );
}

function Missing({error, onRetry, retrying}: {error: Error; onRetry: () => void; retrying: boolean}) {
  const notFound = error instanceof ApiError && error.status === 404;
  return (
    <div className="app-page screen-product-editor">
      <BackLink />
      <PageHeader title={notFound ? 'Product not found' : 'Product'} />
      {notFound ? (
        <Card>
          <div className="editor-missing">
            <p className="muted">It may have been deleted, or the link is out of date.</p>
            <Link to="/products" className={buttonClass({variant: 'secondary', size: 'sm'})}>
              Back to products
            </Link>
          </div>
        </Card>
      ) : (
        <div className="error-block">
          <ErrorNote title="This product could not be loaded" error={error} />
          <Button variant="secondary" size="sm" pending={retrying} pendingLabel="Trying again…" onClick={onRetry}>
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}

function EditorSkeleton() {
  return (
    <div className="app-page screen-product-editor" aria-busy="true" aria-label="Loading product">
      <div className="editor-skeleton-head">
        <Skeleton width="third" />
        <Skeleton width="half" />
        <Skeleton width="third" />
      </div>
      <div className="editor-grid">
        <div className="editor-main">
          {[5, 4, 5].map((rows, i) => (
            <Card key={i}>
              <LoadingBlock rows={rows} />
            </Card>
          ))}
        </div>
        <div className="editor-aside">
          {[2, 3, 2].map((rows, i) => (
            <Card key={i}>
              <LoadingBlock rows={rows} />
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
