import {Link} from '@tanstack/react-router';

import {money} from '../../../lib/format';
import {Field, MoneyInput} from '../../ui';
import {SETTINGS_LIMITS as L} from './limits';
import {currencySymbol, type Errors, fieldAria, isAmount, Section, type SettingsCodec, SettingsShell, ToggleRow, useSettingsDraft} from './shared';

/** Settings · Checkout (port of VAREL `CheckoutSettings.tsx`): guest checkout, phone, order notes, terms, free-shipping threshold. */

interface CheckoutForm {
  guestCheckout: boolean;
  requirePhone: boolean;
  orderNotes: boolean;
  termsText: string;
  freeShippingThreshold: string;
}

export const checkoutCodec: SettingsCodec<CheckoutForm> = {
  toForm: s => ({
    guestCheckout: s.guestCheckout,
    requirePhone: s.requirePhone,
    orderNotes: s.orderNotes,
    termsText: s.termsText,
    freeShippingThreshold: String(s.freeShippingThreshold),
  }),
  toValues: f => ({
    guestCheckout: f.guestCheckout,
    requirePhone: f.requirePhone,
    orderNotes: f.orderNotes,
    termsText: f.termsText.trim(),
    freeShippingThreshold: Math.round(Number(f.freeShippingThreshold) * 100) / 100,
  }),
  validate: f => {
    const e: Errors = {};
    if (!isAmount(f.freeShippingThreshold, L.freeShippingThreshold)) e.freeShippingThreshold = 'Enter zero or more.';
    if (f.termsText.trim().length > L.termsText) e.termsText = `Keep it under ${L.termsText} characters.`;
    return e;
  },
};

export function CheckoutSettings() {
  const draft = useSettingsDraft(checkoutCodec);
  const {set, touch, errors, ro} = draft;
  const currency = draft.data?.currency ?? 'USD';
  return (
    <SettingsShell title="Checkout" description="Who can check out and what the checkout asks for." draft={draft}>
      {f => (
        <>
          <Section id="customers" title="Customer details" description="What checkout asks for before payment.">
            <ToggleRow
              label="Guest checkout"
              description={f.guestCheckout ? 'Anyone can check out with an email address.' : 'Customers sign in or create an account before checkout.'}
              checked={f.guestCheckout}
              onChange={guestCheckout => set({guestCheckout})}
              disabled={ro}
            />
            <ToggleRow
              label="Require a phone number"
              description="Couriers use it for delivery updates."
              checked={f.requirePhone}
              onChange={requirePhone => set({requirePhone})}
              disabled={ro}
            />
            <ToggleRow
              label="Order notes"
              description="An optional note field, up to 500 characters, shown on the order."
              checked={f.orderNotes}
              onChange={orderNotes => set({orderNotes})}
              disabled={ro}
            />
          </Section>

          <Section id="terms" title="Terms" description="When set, customers tick a box agreeing to this text before paying. Leave empty for no checkbox.">
            <Field label="Checkbox text" id="s-terms" error={errors.termsText} hint={`${f.termsText.trim().length}/${L.termsText}`}>
              <textarea
                id="s-terms"
                rows={3}
                value={f.termsText}
                placeholder="I agree to the terms of sale and the returns policy."
                onChange={e => set({termsText: e.target.value})}
                onBlur={() => touch('termsText')}
                {...fieldAria('s-terms', errors.termsText)}
              />
            </Field>
            {f.termsText.trim() && (
              <div>
                <p className="settings-label">Preview</p>
                <div className="settings-terms-preview">
                  <span className="settings-terms-box" aria-hidden="true" />
                  <span>{f.termsText.trim()}</span>
                </div>
              </div>
            )}
          </Section>

          <Section
            id="shipping"
            title="Free shipping"
            description={
              <>
                Zones, methods and rates live in <Link to="/settings/shipping">Shipping</Link>.
              </>
            }>
            <div className="settings-narrow">
              <Field
                label="Free-shipping threshold"
                id="s-threshold"
                error={errors.freeShippingThreshold}
                hint={
                  Number(f.freeShippingThreshold) > 0
                    ? `Free-rate methods apply to orders over ${money(Number(f.freeShippingThreshold) || 0, currency)}. The bag shows progress towards it.`
                    : '0 makes free-rate methods available on every order'
                }>
                <MoneyInput
                  id="s-threshold"
                  symbol={currencySymbol(currency)}
                  value={f.freeShippingThreshold}
                  onChange={e => set({freeShippingThreshold: e.target.value})}
                  onBlur={() => touch('freeShippingThreshold')}
                  {...fieldAria('s-threshold', errors.freeShippingThreshold)}
                />
              </Field>
            </div>
          </Section>
        </>
      )}
    </SettingsShell>
  );
}
