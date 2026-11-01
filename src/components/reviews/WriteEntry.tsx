/* "Write a review" for buyers who have not reviewed the piece yet; a one-line reason for everyone else
   (VAREL ProductReviews.tsx WriteEntry). Nothing until the visitor's eligibility has loaded. */
import {Button} from '@/components/varel/Button';
import {trans} from '@/lib/i18n/react';
import type {TFunction} from '@/lib/i18n';
import type {ReviewEligibility} from '@/lib/types/reviews';

const NOTE = 'max-w-[40ch] text-[14px] leading-body text-text-secondary';

export function WriteEntry({
  t,
  eligibility,
  loginHref,
  onWrite,
}: {
  t: TFunction;
  eligibility: ReviewEligibility | null;
  loginHref: string;
  onWrite: () => void;
}) {
  if (!eligibility) return null;
  if (eligibility.canReview) {
    return (
      <Button variant="outline" onClick={onWrite} className="self-start">
        {t('write')}
      </Button>
    );
  }
  if (eligibility.reason === 'signin') {
    return (
      <p className={NOTE}>
        {trans(t('form.blocked'), {
          signIn: (text) => (
            <a href={loginHref} className="text-text-primary">
              {text}
            </a>
          ),
        })}
      </p>
    );
  }
  if (eligibility.reason === 'purchase') return <p className={NOTE}>{t('eligibility.purchase')}</p>;
  if (eligibility.reason === 'reviewed') return <p className={NOTE}>{t('eligibility.reviewed')}</p>;
  return null;
}
