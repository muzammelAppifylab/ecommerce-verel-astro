import {Link} from '@tanstack/react-router';

import {Field} from '../../ui';
import {SETTINGS_LIMITS as L} from './limits';
import {type Errors, fieldAria, isWhole, Section, type SettingsCodec, SettingsShell, ToggleRow, useSettingsDraft} from './shared';

/** Settings · Customers and privacy (port of VAREL `routes/admin/settings/privacy.tsx`): cookie consent, analytics, reviews, abandoned bags. */

interface PrivacyForm {
  cookieConsent: boolean;
  analyticsEnabled: boolean;
  reviewsEnabled: boolean;
  reviewsRequireApproval: boolean;
  abandonedCartEnabled: boolean;
  abandonedCartHours: string;
}

export const privacyCodec: SettingsCodec<PrivacyForm> = {
  toForm: s => ({
    cookieConsent: s.cookieConsent,
    analyticsEnabled: s.analyticsEnabled,
    reviewsEnabled: s.reviewsEnabled,
    reviewsRequireApproval: s.reviewsRequireApproval,
    abandonedCartEnabled: s.abandonedCartEnabled,
    abandonedCartHours: String(s.abandonedCartHours),
  }),
  toValues: f => ({
    cookieConsent: f.cookieConsent,
    analyticsEnabled: f.analyticsEnabled,
    reviewsEnabled: f.reviewsEnabled,
    reviewsRequireApproval: f.reviewsRequireApproval,
    abandonedCartEnabled: f.abandonedCartEnabled,
    abandonedCartHours: Number(f.abandonedCartHours),
  }),
  validate: f => {
    const e: Errors = {};
    if (!isWhole(f.abandonedCartHours, L.abandonedCartHoursMax) || Number(f.abandonedCartHours) < L.abandonedCartHoursMin) {
      e.abandonedCartHours = `Enter whole hours from ${L.abandonedCartHoursMin} to ${L.abandonedCartHoursMax}.`;
    }
    return e;
  },
};

export function PrivacySettings() {
  const draft = useSettingsDraft(privacyCodec);
  const {set, touch, errors, ro} = draft;
  return (
    <SettingsShell title="Customers and privacy" description="Cookie consent, visit analytics, product reviews and abandoned-bag reminders." draft={draft}>
      {f => (
        <>
          <Section
            id="consent"
            title="Cookies and analytics"
            description={
              <>
                Customers can export or delete their data from their account; admins can do the same from a <Link to="/customers">customer</Link> page.
              </>
            }>
            <ToggleRow
              label="Ask for cookie consent"
              description={
                f.cookieConsent
                  ? 'Visitors see a cookie banner. Analytics only runs for those who accept it.'
                  : 'No banner. Analytics runs for every visitor, so only switch this off where the law allows it.'
              }
              checked={f.cookieConsent}
              onChange={cookieConsent => set({cookieConsent})}
              disabled={ro}
            />
            <ToggleRow
              label="Visit analytics"
              description={
                <>
                  Counts page views, product views, add to bag, checkout starts and searches for <Link to="/analytics">Analytics</Link>. Purchases always come
                  from orders.
                </>
              }
              checked={f.analyticsEnabled}
              onChange={analyticsEnabled => set({analyticsEnabled})}
              disabled={ro}
            />
          </Section>

          <Section id="reviews" title="Reviews" description="Only signed-in customers with a paid order for a piece can review it, once.">
            <ToggleRow
              label="Product reviews"
              description="Show reviews and the write-a-review form on product pages."
              checked={f.reviewsEnabled}
              onChange={reviewsEnabled => set({reviewsEnabled})}
              disabled={ro}
            />
            <ToggleRow
              label="Approve before publishing"
              description="New reviews wait in the moderation queue until approved."
              checked={f.reviewsRequireApproval}
              onChange={reviewsRequireApproval => set({reviewsRequireApproval})}
              disabled={ro || !f.reviewsEnabled}
            />
          </Section>

          <Section
            id="abandoned"
            title="Abandoned bags"
            description={
              <>
                One reminder email per bag with an email address and no order. Bags are listed in <Link to="/abandoned">Abandoned bags</Link>.
              </>
            }>
            <ToggleRow
              label="Send abandoned-bag reminders"
              description="Uses the abandoned bag email template."
              checked={f.abandonedCartEnabled}
              onChange={abandonedCartEnabled => set({abandonedCartEnabled})}
              disabled={ro}
            />
            <div className="settings-narrow">
              <Field
                label="Send after"
                id="s-hours"
                error={errors.abandonedCartHours}
                hint="Hours since the bag was last changed. Reminders go out within 15 minutes of this.">
                <span className="settings-unit">
                  <input
                    id="s-hours"
                    type="number"
                    inputMode="numeric"
                    min={L.abandonedCartHoursMin}
                    max={L.abandonedCartHoursMax}
                    step={1}
                    value={f.abandonedCartHours}
                    onChange={e => set({abandonedCartHours: e.target.value})}
                    onBlur={() => touch('abandonedCartHours')}
                    disabled={ro || !f.abandonedCartEnabled}
                    {...fieldAria('s-hours', errors.abandonedCartHours)}
                  />
                  <span className="muted">hours</span>
                </span>
              </Field>
            </div>
          </Section>
        </>
      )}
    </SettingsShell>
  );
}
