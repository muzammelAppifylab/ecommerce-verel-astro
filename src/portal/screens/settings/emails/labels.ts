/* Labels and tones for Settings · Emails (port of VAREL src/pages/admin/emails/labels.ts; tones are the kit's). */
import type {EmailProviderId, EmailStatus} from '../../../../server/lib/email/types';
import type {Tone} from '../../../ui';

export const PROVIDER_LABEL: Record<EmailProviderId, string> = {
  outbox: 'Outbox',
  resend: 'Resend',
  postmark: 'Postmark',
  ezystudio: 'EzyStudio',
  webhook: 'Webhook',
};

export const providerLabel = (p: string) => PROVIDER_LABEL[p as EmailProviderId] ?? p;

export const STATUS_LABEL: Record<EmailStatus, string> = {
  stored: 'In outbox',
  queued: 'Queued',
  sent: 'Sent',
  failed: 'Failed',
  skipped: 'Skipped',
};

export const STATUS_TONES: Record<EmailStatus, Tone> = {
  stored: 'neutral',
  queued: 'warning',
  sent: 'success',
  failed: 'danger',
  skipped: 'neutral',
};

/** "1 Nov 2026, 14:05" in the viewer's locale. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', {day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'});
}
