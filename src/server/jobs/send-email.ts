import type {JobInfo} from '../../platform/background';

/** The data of a `send-email` job: the outbox row to deliver (never the email itself). */
export interface SendEmailJob {
  messageId: string;
}

/**
 * `send-email` list (no schedule: `sendTemplate` queues one job per message). WP-22 implements.
 * Port of VAREL worker/lib/email/send.ts (provider delivery): loads the `EmailMessage` row, skips
 * it when already sent (at-least-once safe), sends through the configured provider (Resend,
 * Postmark, webhook; key from `config.ownerSecret('EMAIL_API_KEY')`, D9) and records the result.
 * Throw to retry a provider outage; `DontRetry` for a refused address.
 *
 * Wave 0 stub: does nothing.
 */
export async function sendEmailJob(_data: SendEmailJob, _job: JobInfo): Promise<void> {}
