import {useQuery} from '@tanstack/react-query';
import {getRouteApi, Link} from '@tanstack/react-router';

import {ApiError} from '../../api';
import {postQuery} from '../../queries/journal';
import {Button, buttonClass, Card, Notice, PageHeader, Skeleton} from '../../ui';
import {PostEditor} from './PostEditor';

const route = getRouteApi('/journal/$slug');

/** `/dashboard/journal/$slug` (VAREL `EditPost.tsx`): loading skeleton, 404, error + retry, then the editor. */
export function EditPost() {
  const {slug} = route.useParams();
  const q = useQuery(postQuery(slug));

  if (q.isPending) return <EditorSkeleton />;
  if (q.isError || !q.data) {
    const missing = q.error instanceof ApiError && q.error.status === 404;
    return (
      <div className="app-page screen-journal">
        <PageHeader title={missing ? 'Post not found' : 'Post did not load'} />
        <Notice
          tone={missing ? 'info' : 'danger'}
          action={
            <span className="journal-actions-row">
              {!missing && (
                <Button variant="secondary" size="sm" onClick={() => void q.refetch()}>
                  Try again
                </Button>
              )}
              <Link to="/journal" className={buttonClass({variant: 'secondary', size: 'sm'})}>
                All posts
              </Link>
            </span>
          }>
          {missing ? 'It may have been deleted, or the link is wrong.' : (q.error?.message ?? 'Try again.')}
        </Notice>
      </div>
    );
  }
  // key: a fresh editor per post so local form state never leaks between posts.
  return <PostEditor key={q.data.slug} post={q.data} />;
}

function EditorSkeleton() {
  return (
    <div className="app-page screen-journal" aria-busy="true" aria-label="Loading post">
      <Skeleton width="third" />
      <div className="journal-editor">
        <div className="journal-editor-form">
          <Card>
            <Skeleton lines={6} />
          </Card>
          <Card>
            <Skeleton lines={3} />
          </Card>
        </div>
        <div className="journal-editor-preview">
          <Card>
            <Skeleton lines={8} />
          </Card>
        </div>
      </div>
    </div>
  );
}
