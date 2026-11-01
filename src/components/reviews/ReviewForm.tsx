/* The write-a-review form (VAREL ProductReviews.tsx ReviewForm). Client rules mirror the server's exactly
   (src/server/routes/reviews.ts `submitBody`): rating 1–5, title 1–120, review 10–2000 characters after trimming.
   Errors show on submit, then live while typing; the first wrong field gets focus; server field errors (422)
   land on their fields, anything else in the alert line. */
import {useEffect, useId, useRef, useState, type FormEvent} from 'react';

import {Button} from '@/components/varel/Button';
import {Input} from '@/components/varel/Input';
import {Textarea} from '@/components/varel/Textarea';
import type {TFunction} from '@/lib/i18n';
import {isApiError} from '@/lib/storefront-api';
import type {ReviewInput, ReviewSubmitResponse, ReviewsResponse} from '@/lib/types/reviews';

import {submitReview} from './api';
import {RATING_GROUP_ID, RatingInput} from './RatingInput';
import {LABEL} from './ReviewItem';

export const TITLE_MAX = 120;
export const BODY_MIN = 10;
export const BODY_MAX = 2000;

type Field = 'rating' | 'title' | 'body';
type Errors = Partial<Record<Field, string>>;

/** The form's client rules (the server's `submitBody`), as translation keys of the `reviews` namespace. */
export function reviewFormErrors(v: {rating: number; title: string; body: string}): Partial<Record<Field, string>> {
  const errors: Partial<Record<Field, string>> = {};
  const title = v.title.trim();
  const body = v.body.trim();
  if (!v.rating) errors.rating = 'form.chooseRating';
  else if (!Number.isInteger(v.rating) || v.rating < 1 || v.rating > 5) errors.rating = 'form.ratingRange';
  if (!title) errors.title = 'form.titleRequired';
  else if (title.length > TITLE_MAX) errors.title = 'form.titleTooLong';
  if (!body) errors.body = 'form.bodyRequired';
  else if (body.length < BODY_MIN) errors.body = 'form.bodyTooShort';
  else if (body.length > BODY_MAX) errors.body = 'form.bodyTooLong';
  return errors;
}

export function ReviewForm({
  t,
  slug,
  name,
  postingAs,
  settings,
  onClose,
  onDone,
  onSignedOut,
}: {
  t: TFunction;
  slug: string;
  name: string;
  postingAs: string | null | undefined;
  settings: ReviewsResponse['settings'] | null;
  onClose: () => void;
  onDone: (res: ReviewSubmitResponse) => void;
  onSignedOut: () => void;
}) {
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [tried, setTried] = useState(false);
  const [serverErrors, setServerErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<ReviewSubmitResponse | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    ref.current?.scrollIntoView({behavior: 'smooth', block: 'nearest'});
  }, [done]);

  const values = {rating, title, body: text};
  const clientErrors = tried ? reviewFormErrors(values) : {};
  const errorOf = (f: Field) => (clientErrors[f] ? t(clientErrors[f]!) : serverErrors[f]);

  const clearServer = (f: Field) => {
    if (serverErrors[f]) setServerErrors((s) => ({...s, [f]: undefined}));
  };

  const focusFirst = (errs: Partial<Record<Field, unknown>>) => {
    if (errs.rating) {
      const group = document.getElementById(RATING_GROUP_ID);
      (group?.querySelector('[tabindex="0"]') as HTMLElement | null)?.focus();
    } else if (errs.title) document.getElementById(titleId)?.focus();
    else if (errs.body) document.getElementById(bodyId)?.focus();
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    setTried(true);
    setFormError(null);
    const errs = reviewFormErrors(values);
    if (Object.keys(errs).length) {
      focusFirst(errs);
      return;
    }
    const input: ReviewInput = {rating, title: title.trim(), body: text.trim()};
    setPending(true);
    try {
      const res = await submitReview(slug, input);
      setDone(res);
      onDone(res);
    } catch (err) {
      if (isApiError(err) && err.status === 401) {
        onSignedOut();
        return;
      }
      if (isApiError(err) && err.fields && Object.keys(err.fields).length) {
        const f: Errors = {rating: err.field('rating'), title: err.field('title'), body: err.field('body')};
        setServerErrors(f);
        if (!f.rating && !f.title && !f.body) setFormError(err.message);
        focusFirst(f);
      } else if (isApiError(err) && err.status !== 0) {
        setFormError(err.message);
      } else {
        setFormError(t('form.error'));
      }
    } finally {
      setPending(false);
    }
  };

  if (done) {
    return (
      <div ref={ref} className="flex flex-col gap-3 border border-hairline bg-surface-sunken p-6 md:p-8" role="status">
        <p className="font-display text-[24px] leading-snug">{t('form.thanks')}</p>
        <p className="max-w-[52ch] text-[15px] leading-body text-text-secondary">{done.status === 'approved' ? t('form.live') : t('form.pending')}</p>
        <button type="button" onClick={onClose} className="self-start border-b border-strong pb-px font-sans text-label-sm tracking-label uppercase">
          {t('form.close')}
        </button>
      </div>
    );
  }

  return (
    <div ref={ref} className="scroll-mt-28 border border-hairline p-6 md:p-8">
      <div className="mb-6 flex items-start justify-between gap-6">
        <div className="flex flex-col gap-2">
          <span className={LABEL}>{t('write')}</span>
          <p className="font-display text-[24px] leading-snug">{name}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          aria-label={t('form.closeForm')}
          className="-m-2 border-0 p-2 text-ink-400 transition-hover hover:text-ink-900 disabled:cursor-not-allowed"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none">
            <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.25" />
          </svg>
        </button>
      </div>
      <form onSubmit={(e) => void onSubmit(e)} noValidate className="flex flex-col gap-7">
        <RatingInput
          t={t}
          value={rating}
          onChange={(v) => {
            setRating(v);
            clearServer('rating');
          }}
          error={errorOf('rating')}
        />
        <Input
          id={titleId}
          label={t('form.title')}
          value={title}
          maxLength={TITLE_MAX}
          onChange={(e) => {
            setTitle(e.target.value);
            clearServer('title');
          }}
          error={errorOf('title')}
          placeholder={t('form.titlePlaceholder')}
        />
        <Textarea
          id={bodyId}
          label={t('form.body')}
          value={text}
          rows={5}
          maxLength={BODY_MAX}
          onChange={(e) => {
            setText(e.target.value);
            clearServer('body');
          }}
          error={errorOf('body')}
          hint={t('form.bodyHint')}
        />
        {postingAs && <p className="text-body-xs text-text-muted">{t('form.postingAs', {name: postingAs})}</p>}
        {formError && (
          <p role="alert" className="text-body-sm text-signal-critical">
            {formError}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-6">
          <Button type="submit" loading={pending} loadingLabel={t('form.submitting')}>
            {t('form.submit')}
          </Button>
          {settings?.requireApproval && <span className="text-body-xs text-text-muted">{t('form.checked')}</span>}
        </div>
      </form>
    </div>
  );
}
