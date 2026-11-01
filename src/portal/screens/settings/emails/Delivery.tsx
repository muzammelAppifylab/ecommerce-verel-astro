import {useQuery, useQueryClient} from '@tanstack/react-query';
import {Link} from '@tanstack/react-router';
import {useEffect, useRef, useState} from 'react';

import type {EmailDelivery, EmailProviderId} from '../../../../server/lib/email/types';
import {ApiError, hasAbility} from '../../../api';
import {emailDeliveryQuery, emailTemplatesQuery, saveEmailDelivery, sendTestEmail} from '../../../queries/emails';
import {useMe} from '../../../shared';
import {Button, Card, ErrorNote, Field, Icon, LoadingBlock, Notice, rules, Select, StatusBadge, useForm, useToast} from '../../../ui';
import {PROVIDER_LABEL, STATUS_LABEL} from './labels';

/*
 * Delivery: provider, sender and staff alerts. WP-22: port of VAREL src/pages/admin/emails/EmailSettings.tsx. VAREL
 * saved through the shared settings draft; here the tab saves the six email columns through
 * PATCH /site-api/manage/emails/delivery (same rules as the server, src/server/lib/email/delivery.ts).
 * The API key is the owner secret EMAIL_API_KEY, never stored here; the page only shows whether it is added.
 */

const PROVIDERS: {value: EmailProviderId; label: string; detail: string}[] = [
  {value: 'outbox', label: 'Outbox', detail: 'Emails are kept in the Outbox tab and not delivered. For setup, demos and local development.'},
  {value: 'resend', label: 'Resend', detail: 'Delivered through the Resend API. Verify your sending domain in Resend first.'},
  {value: 'postmark', label: 'Postmark', detail: 'Delivered through the Postmark API with your server token.'},
  {value: 'ezystudio', label: 'EzyStudio email service', detail: 'EzyStudio’s email API. Needs the service endpoint and an API key.'},
  {value: 'webhook', label: 'Webhook', detail: 'Each email is POSTed as JSON to your URL, for Zapier, Make, n8n or a custom relay.'},
];

const NEEDS_KEY: Record<EmailProviderId, 'no' | 'optional' | 'yes'> = {outbox: 'no', resend: 'yes', postmark: 'yes', ezystudio: 'yes', webhook: 'optional'};
const NEEDS_ENDPOINT: EmailProviderId[] = ['ezystudio', 'webhook'];
const ENDPOINT_MESSAGE = 'Use a full link starting with https://';

/** The server's endpoint rule (src/server/lib/email/provider.ts `endpointProblem`): https, a public DNS name, no port or login. */
export function endpointOk(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  if (!host || host.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || !host.includes('.')) return false;
  if (/(^|\.)(localhost|local|internal|localdomain|home|lan|intranet|corp)$/i.test(host)) return false;
  return /^[a-z0-9.-]+$/.test(host) && !host.endsWith('.');
}

type DeliveryForm = {
  emailProvider: string;
  endpoint: string;
  messageStream: string;
  emailFromName: string;
  emailFromAddress: string;
  emailReplyTo: string;
  staffAlertEmail: string;
};

const toForm = (d: EmailDelivery): DeliveryForm => ({
  emailProvider: d.emailProvider,
  endpoint: d.emailConfig.endpoint ?? '',
  messageStream: d.emailConfig.messageStream ?? '',
  emailFromName: d.emailFromName,
  emailFromAddress: d.emailFromAddress,
  emailReplyTo: d.emailReplyTo ?? '',
  staffAlertEmail: d.staffAlertEmail ?? '',
});

export function Delivery() {
  const delivery = useQuery(emailDeliveryQuery);
  if (delivery.error) return <ErrorNote error={delivery.error} title="Delivery settings could not be loaded" />;
  if (!delivery.data) {
    return (
      <Card>
        <LoadingBlock rows={4} />
      </Card>
    );
  }
  return <DeliveryForm data={delivery.data} />;
}

function DeliveryForm({data}: {data: EmailDelivery}) {
  const qc = useQueryClient();
  const me = useMe().data;
  const ro = !hasAbility(me?.abilities, 'manageStoreSettings');
  const templates = useQuery(emailTemplatesQuery).data;
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const initial = toForm(data);
  const providerRef = useRef(initial.emailProvider);
  const form = useForm<DeliveryForm>(initial, {
    endpoint: [
      v => (NEEDS_ENDPOINT.includes(providerRef.current as EmailProviderId) ? (endpointOk(v) ? null : ENDPOINT_MESSAGE) : null),
    ],
    messageStream: [rules.maxLength(100, 'Keep the stream name under 100 characters'), rules.pattern(/^[a-z0-9-]+$/i, 'Use letters, digits and dashes')],
    emailFromName: [rules.required('Enter a sender name'), rules.maxLength(80, 'Keep a sender name under 80 characters')],
    emailFromAddress: [rules.required('Enter a valid email address.'), rules.email('Enter a valid email address.'), rules.maxLength(254)],
    emailReplyTo: [rules.email('Enter a valid email address, or leave it empty.'), rules.maxLength(254)],
    staffAlertEmail: [rules.email('Enter a valid email address, or leave it empty.'), rules.maxLength(254)],
  });
  const f = form.values;
  providerRef.current = f.emailProvider;
  const dirty = (Object.keys(initial) as (keyof DeliveryForm)[]).some(k => f[k] !== initial[k]);

  // A fresh server copy (after a save) becomes the new baseline.
  useEffect(() => {
    form.reset(toForm(data));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const provider = (f.emailProvider as EmailProviderId) || 'outbox';
  const p = PROVIDERS.find(x => x.value === provider) ?? PROVIDERS[0]!;
  const needsKey = NEEDS_KEY[provider];
  const keySet = data.secrets.emailApiKey;

  const save = form.submit(async v => {
    setSaving(true);
    setStatus(null);
    const emailConfig: {endpoint?: string; messageStream?: string} = {};
    if (NEEDS_ENDPOINT.includes(v.emailProvider as EmailProviderId) && v.endpoint.trim()) emailConfig.endpoint = v.endpoint.trim();
    if (v.emailProvider === 'postmark' && v.messageStream.trim()) emailConfig.messageStream = v.messageStream.trim();
    try {
      await saveEmailDelivery(qc, {
        emailProvider: v.emailProvider as EmailProviderId,
        emailConfig,
        emailFromName: v.emailFromName.trim(),
        emailFromAddress: v.emailFromAddress.trim().toLowerCase(),
        emailReplyTo: v.emailReplyTo.trim() ? v.emailReplyTo.trim().toLowerCase() : null,
        staffAlertEmail: v.staffAlertEmail.trim() ? v.staffAlertEmail.trim().toLowerCase() : null,
      });
      toast.success('Email delivery saved');
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) {
        const fields = err.fields;
        form.setServerErrors({...fields, endpoint: fields['emailConfig.endpoint'] ?? fields.emailConfig ?? fields.endpoint});
      }
      setStatus(err instanceof Error ? err.message : 'That did not work. Try again.');
    } finally {
      setSaving(false);
    }
  });

  async function sendTest() {
    const t = templates?.find(x => x.key === 'welcome') ?? templates?.[0];
    if (!t) return;
    setTesting(true);
    try {
      const m = await sendTestEmail(qc, t.key, {subject: t.subject, body: t.body, vars: t.sample});
      if (m.status === 'failed') toast.danger(`Test email failed: ${m.error ?? 'unknown error'}`);
      else toast.success(m.status === 'stored' ? `Saved to the outbox for ${m.to}` : `Test email ${STATUS_LABEL[m.status].toLowerCase()} to ${m.to}`);
    } catch (err) {
      toast.danger(err instanceof Error ? err.message : 'That did not work. Try again.');
    } finally {
      setTesting(false);
    }
  }

  return (
    <form noValidate onSubmit={save} className="emails-delivery">
      <Card title="Provider" description="Where emails go after they are rendered. Every email is also kept in the log.">
        <div className="emails-delivery-fields">
          <Field label="Provider" id="f-emailProvider" hint={p.detail}>
            <Select {...form.field('emailProvider')} disabled={ro} options={PROVIDERS.map(x => ({value: x.value, label: x.label}))} />
          </Field>

          {NEEDS_ENDPOINT.includes(provider) && (
            <Field
              label={provider === 'webhook' ? 'Webhook URL' : 'Service endpoint'}
              id="f-endpoint"
              error={form.error('endpoint')}
              hint="Receives a POST with the JSON body described in the email docs and answers 2xx">
              <input
                {...form.field('endpoint')}
                type="url"
                inputMode="url"
                readOnly={ro}
                className="emails-mono"
                placeholder={provider === 'webhook' ? 'https://hooks.example.com/varel-email' : 'https://mail.ezystudio.dev/v1/messages'}
              />
            </Field>
          )}

          {provider === 'postmark' && (
            <Field label="Message stream" id="f-messageStream" error={form.error('messageStream')} hint="Leave empty for the default transactional stream, outbound">
              <input {...form.field('messageStream')} readOnly={ro} placeholder="outbound" />
            </Field>
          )}

          {needsKey !== 'no' && (
            <div className="emails-key">
              <Icon name={keySet ? 'check-circle' : 'alert'} size={18} className={keySet ? 'emails-text-success' : needsKey === 'yes' ? 'emails-text-danger' : 'emails-muted'} />
              <div>
                <p className="emails-key-title">
                  API key{' '}
                  <StatusBadge tone={keySet ? 'success' : needsKey === 'yes' ? 'danger' : 'neutral'}>
                    {keySet ? 'Set' : needsKey === 'yes' ? 'Missing' : 'Not set'}
                  </StatusBadge>
                </p>
                <p className="emails-muted">
                  {needsKey === 'optional'
                    ? 'Optional. When set it is sent as Authorization: Bearer so your endpoint can check it.'
                    : 'Stored as an owner secret, never in the database.'}{' '}
                  {!keySet && "Add EMAIL_API_KEY in the dashboard's secrets."}
                </p>
              </div>
            </div>
          )}

          <div className="emails-test-row">
            <p className="emails-muted">
              {dirty
                ? 'Save your changes to test the new setup.'
                : `Sends the welcome email with sample data to ${me?.viewer.email ?? 'you'} through ${PROVIDER_LABEL[data.emailProvider]}.`}
            </p>
            <Button variant="secondary" size="sm" icon="mail" onClick={() => void sendTest()} disabled={dirty || ro || !templates} pending={testing} pendingLabel="Sending…">
              Send test email
            </Button>
          </div>
        </div>
      </Card>

      <Card title="Sender" description="Who emails come from. The address must be verified with your provider.">
        <div className="emails-delivery-fields emails-two-cols">
          <Field label="From name" id="f-emailFromName" error={form.error('emailFromName')}>
            <input {...form.field('emailFromName')} readOnly={ro} maxLength={80} autoComplete="off" />
          </Field>
          <Field label="From address" id="f-emailFromAddress" error={form.error('emailFromAddress')}>
            <input {...form.field('emailFromAddress')} type="email" readOnly={ro} autoComplete="off" />
          </Field>
          <Field label="Reply-to" id="f-emailReplyTo" optional error={form.error('emailReplyTo')} hint="Where customer replies go when it is not the from address">
            <input {...form.field('emailReplyTo')} type="email" readOnly={ro} placeholder={data.supportEmail} autoComplete="off" />
          </Field>
        </div>
      </Card>

      <Card title="Staff alerts" description="Contact form messages and low-stock alerts go to this address.">
        <div className="emails-delivery-fields emails-two-cols">
          <Field
            label="Alert address"
            id="f-staffAlertEmail"
            error={form.error('staffAlertEmail')}
            hint={`Leave empty to use the support address${data.supportEmail ? `, ${data.supportEmail}` : ''}`}>
            <input {...form.field('staffAlertEmail')} type="email" readOnly={ro} placeholder={data.supportEmail} autoComplete="off" />
          </Field>
        </div>
        <p className="emails-muted emails-alert-note">
          Low-stock alerts are sent when an order takes a variant to {data.lowStockThreshold} or fewer. Change the threshold in{' '}
          <Link to="/settings/inventory">Inventory and returns</Link>.
        </p>
      </Card>

      {status && <Notice tone="danger">{status}</Notice>}

      {!ro && (
        <div className="emails-actions">
          <Button type="submit" disabled={!dirty} pending={saving} pendingLabel="Saving…">
            Save changes
          </Button>
          <Button variant="secondary" disabled={!dirty || saving} onClick={() => form.reset(initial)}>
            Discard
          </Button>
        </div>
      )}
    </form>
  );
}
