/* Row and bulk actions for the journal list (port of VAREL `pages/admin/journal/JournalActions.tsx`).
   Status moves are draft ⇄ published; every status move and delete confirms (kit `useConfirm`). */

import {useQueryClient} from '@tanstack/react-query';
import {useNavigate} from '@tanstack/react-router';
import {useState} from 'react';

import {pluralize} from '../../../lib/format';
import type {AdminPostRow, PostStatus} from '../../../lib/types/admin/content';
import {deletePosts, duplicatePost, invalidatePosts, setPostsStatus} from '../../queries/journal';
import {BulkAction, BulkBar, Menu, type MenuItem, StatusBadge, useConfirm, useToast} from '../../ui';
import {isLive} from './form';

type Pending = {kind: 'status'; status: PostStatus; rows: AdminPostRow[]} | {kind: 'delete'; rows: AdminPostRow[]};

const errorText = (e: unknown, fallback = 'That did not work. Try again.') => (e instanceof Error && e.message ? e.message : fallback);

export function PostStatusBadge({post}: {post: Pick<AdminPostRow, 'status' | 'publishedAt'>}) {
  if (post.status === 'published' && !isLive(post)) return <StatusBadge tone="warning">Scheduled</StatusBadge>;
  return post.status === 'published' ? <StatusBadge tone="success">Published</StatusBadge> : <StatusBadge tone="neutral">Draft</StatusBadge>;
}

/** Shared runner: status changes and deletes for one or many posts, behind a confirm dialog. */
function usePostActions(onDone?: (slugs: string[], deleted: boolean) => void) {
  const confirm = useConfirm();
  const toast = useToast();
  const qc = useQueryClient();

  const report = (verb: string, done: number, failed: {key: string; error: unknown}[]) => {
    if (done) toast.success(`${pluralize(done, 'post')} ${verb}`);
    if (failed.length) toast.danger(`${failed.map(f => f.key).join(', ')} could not be ${verb}: ${errorText(failed[0]!.error)}`);
  };

  return (pending: Pending) => {
    const n = pending.rows.length;
    const slugs = pending.rows.map(r => r.slug);
    const del = pending.kind === 'delete';
    const publish = !del && pending.status === 'published';
    return confirm({
      title: del ? `Delete ${pluralize(n, 'post')}?` : publish ? `Publish ${pluralize(n, 'post')}?` : `Move ${pluralize(n, 'post')} to drafts?`,
      body: (
        <>
          {del
            ? 'They are removed from the admin and the storefront journal. This cannot be undone.'
            : publish
              ? 'Posts without a publish date go live now; scheduled dates are kept.'
              : 'They disappear from the storefront journal until published again.'}
          <span className="journal-confirm-list">
            {pending.rows.map(p => (
              <span key={p.slug} className="journal-confirm-row">
                <span className="journal-confirm-title">{p.title}</span>
                <PostStatusBadge post={p} />
              </span>
            ))}
          </span>
        </>
      ),
      confirmLabel: del ? 'Delete' : publish ? 'Publish' : 'Move to drafts',
      pendingLabel: del ? 'Deleting…' : publish ? 'Publishing…' : 'Moving…',
      tone: del ? 'danger' : 'primary',
      action: async () => {
        const verb = del ? 'deleted' : publish ? 'published' : 'moved to drafts';
        const out = del ? await deletePosts(slugs) : await setPostsStatus(slugs, (pending as {status: PostStatus}).status);
        invalidatePosts(qc, del);
        // Nothing worked: keep the dialog open with the reason.
        if (!out.done.length && out.failed.length) throw new Error(errorText(out.failed[0]!.error));
        report(verb, out.done.length, out.failed);
        onDone?.(
          out.done.map(d => (typeof d === 'string' ? d : d.slug)),
          del
        );
      },
    });
  };
}

/* ---------- Single row ---------- */

export function PostRowMenu({post, onBusy}: {post: AdminPostRow; onBusy?: (busy: boolean) => void}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const run = usePostActions();
  const [copying, setCopying] = useState(false);
  const edit = () => void navigate({to: '/journal/$slug', params: {slug: post.slug}});

  const duplicate = () => {
    setCopying(true);
    onBusy?.(true);
    duplicatePost(post.slug)
      .then(copy => {
        invalidatePosts(qc, true);
        toast.success(`Copied as a new draft: ${copy.title}`);
      })
      .catch((e: unknown) => toast.danger(errorText(e, 'The post could not be duplicated.')))
      .finally(() => {
        setCopying(false);
        onBusy?.(false);
      });
  };

  const items: MenuItem[] = [
    {label: 'Edit', icon: 'pencil', onSelect: edit},
    ...(isLive(post)
      ? [{label: 'View on store', icon: 'external' as const, onSelect: () => void window.open(`/journal/${post.slug}/`, '_blank', 'noopener,noreferrer')}]
      : []),
    {label: copying ? 'Duplicating…' : 'Duplicate as draft', icon: 'copy', disabled: copying, onSelect: duplicate},
    'separator',
    post.status === 'draft'
      ? {label: 'Publish', icon: 'upload', onSelect: () => void run({kind: 'status', status: 'published', rows: [post]})}
      : {label: 'Move to drafts', icon: 'file-text', onSelect: () => void run({kind: 'status', status: 'draft', rows: [post]})},
    {label: 'Delete…', icon: 'trash', danger: true, onSelect: () => void run({kind: 'delete', rows: [post]})},
  ];

  return <Menu label={`Actions for ${post.title}`} items={items} disabled={copying} />;
}

/* ---------- Bulk ---------- */

export function PostsBulkBar({
  rows,
  onClear,
  onDone,
}: {
  rows: AdminPostRow[];
  onClear: () => void;
  /** Called with the slugs that changed, so they can leave the selection. */
  onDone: (slugs: string[], deleted: boolean) => void;
}) {
  const run = usePostActions(onDone);
  const drafts = rows.filter(r => r.status === 'draft');
  const published = rows.filter(r => r.status === 'published');
  const partial = (n: number) => (n > 0 && n < rows.length ? ` (${n})` : '');

  return (
    <BulkBar count={rows.length} noun={['post', 'posts']} onClear={onClear}>
      <BulkAction
        icon="upload"
        disabled={!drafts.length}
        hint={drafts.length ? undefined : 'All selected posts are already published'}
        onClick={() => void run({kind: 'status', status: 'published', rows: drafts})}>
        Publish{partial(drafts.length)}
      </BulkAction>
      <BulkAction
        icon="file-text"
        disabled={!published.length}
        hint={published.length ? undefined : 'All selected posts are already drafts'}
        onClick={() => void run({kind: 'status', status: 'draft', rows: published})}>
        Move to drafts{partial(published.length)}
      </BulkAction>
      <BulkAction icon="trash" danger onClick={() => void run({kind: 'delete', rows})}>
        Delete
      </BulkAction>
    </BulkBar>
  );
}
