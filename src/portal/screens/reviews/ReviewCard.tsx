import {useMutation, useQueryClient} from '@tanstack/react-query';
import {Link} from '@tanstack/react-router';
import {useId, useState} from 'react';

import {photoUrl} from '../../../lib/format';
import type {AdminReview, AdminReviewStatus} from '../../../lib/types/admin/reviews';
import {deleteReview, invalidateReviews, updateReview} from '../../queries/reviews';
import {when} from '../../shared';
import {Badge, Button, Icon, StatusBadge, useConfirm, useToast, type Tone} from '../../ui';

/** One review in the queue (VAREL `Reviews.tsx` `ReviewCard`): product, stars, text, reply, actions. */

const STATUS_TONE: Record<AdminReviewStatus, Tone> = {pending: 'warning', approved: 'success', rejected: 'danger'};
const STATUS_LABEL: Record<AdminReviewStatus, string> = {pending: 'Pending', approved: 'Approved', rejected: 'Rejected'};
const REPLY_MAX = 1000;

/** Five small stars, drawn here (the portal never imports the storefront's components). */
export function ReviewStars({value}: {value: number}) {
  return (
    <span className="review-stars" role="img" aria-label={`${value} out of 5`}>
      {[1, 2, 3, 4, 5].map(n => (
        <svg key={n} viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" data-on={n <= value ? '' : undefined}>
          <path d="M12 2.5l2.94 6.1 6.56.78-4.85 4.6 1.27 6.52L12 17.27 6.08 20.5l1.27-6.52L2.5 9.38l6.56-.78z" />
        </svg>
      ))}
    </span>
  );
}

const message = (e: unknown) => (e instanceof Error ? e.message : 'That did not work. Try again.');

export function ReviewCard({review: r, selected, onSelect}: {review: AdminReview; selected: boolean; onSelect: (on: boolean) => void}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const replyId = useId();
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState(r.reply ?? '');
  /** What is running on this card: only that button shows pending, the others are disabled. */
  const [busy, setBusy] = useState<AdminReviewStatus | 'reply' | null>(null);

  const update = useMutation({mutationFn: updateReview, onSettled: () => invalidateReviews(queryClient)});
  const remove = useMutation({mutationFn: deleteReview, onSettled: () => invalidateReviews(queryClient)});
  const working = busy !== null || remove.isPending;

  const setStatus = async (status: AdminReviewStatus) => {
    setBusy(status);
    try {
      await update.mutateAsync({id: r.id, status});
      toast.success(
        status === 'approved' ? `Review approved · now live on ${r.productName}` : status === 'rejected' ? 'Review rejected' : 'Review moved to pending'
      );
    } catch (e) {
      toast.danger(message(e));
    } finally {
      setBusy(null);
    }
  };

  const saveReply = async () => {
    const text = reply.trim();
    setBusy('reply');
    try {
      await update.mutateAsync({id: r.id, reply: text || null});
      setReplying(false);
      toast.success(text ? 'Reply saved' : 'Reply removed');
    } catch (e) {
      toast.danger(message(e));
    } finally {
      setBusy(null);
    }
  };

  const askDelete = () =>
    void confirm({
      title: 'Delete this review?',
      body: 'It is removed for good and leaves the product rating. To hide it but keep a record, reject it instead.',
      confirmLabel: 'Delete review',
      pendingLabel: 'Deleting…',
      action: async () => {
        await remove.mutateAsync(r.id);
        toast.success('Review deleted');
      },
    });

  return (
    <li className="review-card" data-selected={selected ? '' : undefined}>
      <label className="review-card-check">
        <input type="checkbox" checked={selected} onChange={e => onSelect(e.target.checked)} aria-label={`Select review "${r.title}"`} />
      </label>
      <div className="review-card-main">
        <div className="review-card-head">
          <Link to="/products/$id" params={{id: r.productId}} className="review-card-product">
            {r.productImage && <img src={photoUrl(r.productImage, 80)} alt="" width={36} height={48} loading="lazy" />}
            <span className="review-card-product-text">
              <span className="review-card-product-name">{r.productName}</span>
              <span className="review-card-date">{when(r.createdAt)}</span>
            </span>
          </Link>
          <span className="badges">
            {r.verifiedPurchase && <Badge tone="neutral">Verified purchase</Badge>}
            <StatusBadge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</StatusBadge>
          </span>
        </div>

        <div className="review-card-text">
          <ReviewStars value={r.rating} />
          <p className="review-card-title">{r.title}</p>
          <p className="review-card-body">{r.body}</p>
          <p className="review-card-author">
            {r.name} · <a href={`mailto:${r.email}`}>{r.email}</a>
          </p>
        </div>

        {replying ? (
          <div className="field review-reply-editor">
            <label htmlFor={replyId}>Public reply</label>
            <textarea
              id={replyId}
              value={reply}
              maxLength={REPLY_MAX}
              rows={3}
              onChange={e => setReply(e.target.value)}
              placeholder="Thank the customer, answer a fit question, or explain what changed."
              autoFocus
            />
            <div className="review-reply-actions">
              <Button size="sm" pending={busy === 'reply'} pendingLabel="Saving…" disabled={working && busy !== 'reply'} onClick={() => void saveReply()}>
                Save reply
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy === 'reply'}
                onClick={() => {
                  setReplying(false);
                  setReply(r.reply ?? '');
                }}>
                Cancel
              </Button>
              <span className="muted review-reply-count">
                {reply.length}/{REPLY_MAX}
              </span>
            </div>
          </div>
        ) : (
          r.reply && (
            <div className="review-reply">
              <p className="review-reply-label">Reply from VAREL</p>
              <p className="review-reply-text">{r.reply}</p>
            </div>
          )
        )}

        <div className="review-card-actions">
          {r.status !== 'approved' && (
            <Button size="sm" pending={busy === 'approved'} pendingLabel="Approving…" disabled={working} onClick={() => void setStatus('approved')}>
              Approve
            </Button>
          )}
          {r.status !== 'rejected' && (
            <Button
              size="sm"
              variant="secondary"
              pending={busy === 'rejected'}
              pendingLabel="Rejecting…"
              disabled={working}
              onClick={() => void setStatus('rejected')}>
              Reject
            </Button>
          )}
          {!replying && (
            <Button size="sm" variant="secondary" disabled={working} onClick={() => setReplying(true)}>
              {r.reply ? 'Edit reply' : 'Reply'}
            </Button>
          )}
          <Button size="sm" variant="ghost" className="review-card-delete" disabled={working} onClick={askDelete}>
            <Icon name="trash" size={16} />
            Delete
          </Button>
        </div>
      </div>
    </li>
  );
}
