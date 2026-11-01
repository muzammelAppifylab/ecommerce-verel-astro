import {Button, EmptyState} from '@/components/varel';

export interface CatalogNoticeProps {
  title: string;
  description?: string;
  /** The outline link button under the text */
  actionLabel: string;
  actionHref: string;
  className?: string;
}

/** A listing page's not-found / unavailable block (VAREL Category.tsx states), rendered on the server only (no
    client directive). A React component so the action button is a React element: an Astro-JSX element passed
    as a React prop cannot be rendered by React. */
export function CatalogNotice({title, description, actionLabel, actionHref, className}: CatalogNoticeProps) {
  return (
    <EmptyState
      className={className}
      title={title}
      description={description}
      action={
        <Button href={actionHref} variant="outline">
          {actionLabel}
        </Button>
      }
    />
  );
}
