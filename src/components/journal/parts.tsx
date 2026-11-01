/* React pieces of the journal pages. `Trail` and `JournalState` are rendered on the server only (no
   `client:` directive, zero JS); `JournalNewsletter` is the one island (`client:visible`). Each wraps
   F2's components in a <TextProvider> so their own words follow the page language. */
import {Breadcrumb, type BreadcrumbItem} from '@/components/varel/Breadcrumb';
import {Button} from '@/components/varel/Button';
import {EmptyState} from '@/components/varel/EmptyState';
import {NewsletterForm} from '@/components/varel/NewsletterForm';
import {type Dicts, TextProvider} from '@/components/varel/text';

/** The breadcrumb trail (its aria-label comes from `layout:ui.breadcrumb`). */
export function Trail({items, className, locale, dicts}: {items: BreadcrumbItem[]; className?: string; locale: string; dicts: Dicts}) {
  return (
    <TextProvider locale={locale} dicts={dicts}>
      <Breadcrumb className={className} items={items} />
    </TextProvider>
  );
}

/** An empty, missing or failed state, with an outline link button ("All entries", "Try again"). */
export function JournalState({
  title,
  description,
  actionLabel,
  actionHref,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
}) {
  return (
    <EmptyState
      title={title}
      description={description}
      action={
        actionLabel && actionHref ? (
          <Button href={actionHref} variant="outline" className="text-label-sm">
            {actionLabel}
          </Button>
        ) : undefined
      }
    />
  );
}

/** The journal's newsletter sign-up (`source: "journal"`); its field and button words come from `journal:newsletterForm.*`. */
export function JournalNewsletter({locale, dicts, note, successNote}: {locale: string; dicts: Dicts; note: string; successNote: string}) {
  return (
    <TextProvider locale={locale} dicts={dicts}>
      <NewsletterForm source="journal" note={note} successNote={successNote} />
    </TextProvider>
  );
}
