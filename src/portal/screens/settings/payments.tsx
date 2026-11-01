import {useQuery} from '@tanstack/react-query';
import {useEffect, useState} from 'react';

import {paymentsStatusQuery} from '../../queries/settings';
import {Button, Field, Notice, RadioCards, Skeleton, StatusBadge, useToast} from '../../ui';
import {PUBLISHABLE_KEY_RE, SETTINGS_LIMITS as L} from './limits';
import {type Errors, fieldAria, firstProblem, Section, type SettingsCodec, SettingsShell, useSettingsDraft} from './shared';

/**
 * Settings · Payments (port of VAREL `PaymentsSettings.tsx`): the provider (Stripe or simulated), the
 * publishable key, whether the owner secrets are set, and the webhook endpoint to register in Stripe.
 * Secret keys never pass through the dashboard: they are the site's owner secrets.
 */

interface PaymentsForm {
  paymentProvider: 'stripe' | 'simulated';
  stripePublishableKey: string;
}

export const paymentsCodec: SettingsCodec<PaymentsForm> = {
  toForm: s => ({paymentProvider: s.paymentProvider, stripePublishableKey: s.stripePublishableKey ?? ''}),
  toValues: f => ({paymentProvider: f.paymentProvider, stripePublishableKey: f.stripePublishableKey.trim() || null}),
  validate: f => {
    const e: Errors = {};
    const pk = f.stripePublishableKey.trim();
    if (pk && (pk.length > L.stripePublishableKey || !PUBLISHABLE_KEY_RE.test(pk))) {
      e.stripePublishableKey = 'Use a publishable key starting with pk_test_ or pk_live_.';
    }
    if (f.paymentProvider === 'stripe' && !pk) e.stripePublishableKey = 'Stripe needs a publishable key.';
    return e;
  },
};

const PROVIDERS: {value: PaymentsForm['paymentProvider']; title: string; body: string}[] = [
  {
    value: 'simulated',
    title: 'Simulated',
    body: 'Card numbers are checked and orders are paid on the spot. No money moves. For local development and demos.',
  },
  {
    value: 'stripe',
    title: 'Stripe',
    body: 'Cards, wallets and local methods through the Stripe Payment Element. Orders are paid when Stripe confirms.',
  },
];

const modeOf = (k: string) => (k.startsWith('pk_test_') ? 'test' : k.startsWith('pk_live_') ? 'live' : null);

export function PaymentsSettings() {
  const draft = useSettingsDraft(paymentsCodec);
  const {set, touch, errors, ro} = draft;
  // The status follows the saved settings (useUpdateSettings invalidates it).
  const status = useQuery({...paymentsStatusQuery, enabled: !ro});
  const s = status.data;

  return (
    <SettingsShell title="Payments" description="How customers pay at checkout." draft={draft}>
      {f => {
        const pkMode = modeOf(f.stripePublishableKey.trim());
        const sk = s?.secretKey;
        const mismatch = !!(sk?.mode && pkMode && sk.mode !== pkMode);
        const fallback = f.paymentProvider === 'stripe' && s && !sk?.set;
        return (
          <>
            <Section id="provider" title="Provider" description="Simulated stays available as the fallback whenever Stripe is not fully set up.">
              <RadioCards
                legend="Payment provider"
                name="provider"
                value={f.paymentProvider}
                onChange={paymentProvider => set({paymentProvider})}
                options={PROVIDERS.map(p => ({
                  value: p.value,
                  disabled: ro,
                  title: (
                    <span className="settings-inline">
                      {p.title}
                      {s?.active === p.value && <StatusBadge tone="success">Live at checkout</StatusBadge>}
                    </span>
                  ),
                  description: p.body,
                }))}
              />
              {fallback && (
                <Notice tone="warning">STRIPE_SECRET_KEY is not set as an owner secret, so checkout keeps using simulated payments until it is.</Notice>
              )}
            </Section>

            <Section
              id="stripe"
              title="Stripe keys"
              description="The publishable key is public and saved here. The secret key and webhook signing secret are owner secrets.">
              <Field
                label="Publishable key"
                id="s-pk"
                error={errors.stripePublishableKey}
                hint="From Stripe Dashboard → Developers → API keys. Starts with pk_test_ or pk_live_.">
                <input
                  id="s-pk"
                  className="settings-mono"
                  value={f.stripePublishableKey}
                  placeholder="pk_test_…"
                  spellCheck={false}
                  autoComplete="off"
                  onChange={e => set({stripePublishableKey: e.target.value})}
                  onBlur={() => touch('stripePublishableKey')}
                  {...fieldAria('s-pk', errors.stripePublishableKey)}
                />
              </Field>
              {pkMode && (
                <p className="settings-inline">
                  <ModeBadge mode={pkMode} />
                </p>
              )}

              <div className="settings-stack">
                <p className="settings-label">Owner secrets</p>
                {status.isLoading ? (
                  <Skeleton lines={2} />
                ) : status.error ? (
                  <Notice tone="danger">{firstProblem(status.error)}</Notice>
                ) : (
                  <ul className="settings-secrets">
                    <SecretRow name="STRIPE_SECRET_KEY" set={!!sk?.set} mode={sk?.mode ?? null} note="sk_test_… or sk_live_…" />
                    <SecretRow name="STRIPE_WEBHOOK_SECRET" set={!!s?.webhookSecret.set} note="whsec_… from the webhook endpoint" />
                  </ul>
                )}
                <p className="field-hint">Add them in the site's owner secrets (live and Preview): STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET.</p>
                {mismatch && (
                  <Notice tone="danger">
                    The secret key is in {sk?.mode} mode but the publishable key is in {pkMode} mode. Use keys from the same mode.
                  </Notice>
                )}
              </div>
            </Section>

            <Section id="webhook" title="Webhook" description="Stripe tells the store when a payment succeeds, fails or is refunded.">
              {s ? (
                <>
                  <Field label="Endpoint URL" id="s-webhook" hint="Stripe Dashboard → Developers → Webhooks → Add endpoint.">
                    <span className="settings-inline settings-grow">
                      <input
                        id="s-webhook"
                        readOnly
                        className="settings-mono"
                        value={s.webhookUrl}
                        aria-describedby="s-webhook-hint"
                        onFocus={e => e.currentTarget.select()}
                      />
                      <CopyButton text={s.webhookUrl} />
                    </span>
                  </Field>
                  <div>
                    <p className="settings-label">Events to send</p>
                    <ul className="settings-chips">
                      {s.webhookEvents.map(e => (
                        <li key={e} className="settings-code-chip">
                          {e}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <p className="field-hint">Copy the endpoint's signing secret into STRIPE_WEBHOOK_SECRET. Unpaid orders are released after 60 minutes.</p>
                </>
              ) : status.error ? (
                <Notice tone="danger">{firstProblem(status.error)}</Notice>
              ) : (
                <Skeleton lines={2} />
              )}
            </Section>
          </>
        );
      }}
    </SettingsShell>
  );
}

function ModeBadge({mode}: {mode: 'test' | 'live'}) {
  return mode === 'test' ? <StatusBadge tone="warning">Test mode</StatusBadge> : <StatusBadge tone="success">Live mode</StatusBadge>;
}

function SecretRow({name, set, mode, note}: {name: string; set: boolean; mode?: 'test' | 'live' | null; note: string}) {
  return (
    <li className="settings-secret">
      <span className="settings-secret-text">
        <span className="settings-mono">{name}</span>
        <span className="muted">{note}</span>
      </span>
      <span className="settings-inline">
        {mode && <ModeBadge mode={mode} />}
        <StatusBadge tone={set ? 'success' : 'neutral'}>{set ? 'Set' : 'Not set'}</StatusBadge>
      </span>
    </li>
  );
}

function CopyButton({text}: {text: string}) {
  const [done, setDone] = useState(false);
  const toast = useToast();
  useEffect(() => {
    if (!done) return;
    const t = window.setTimeout(() => setDone(false), 1600);
    return () => window.clearTimeout(t);
  }, [done]);
  return (
    <Button
      variant="secondary"
      size="sm"
      icon={done ? 'check' : 'copy'}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          toast.success('Webhook URL copied');
        } catch {
          toast.danger('Copy did not work. Select the URL and copy it.');
        }
      }}>
      {done ? 'Copied' : 'Copy'}
    </Button>
  );
}
