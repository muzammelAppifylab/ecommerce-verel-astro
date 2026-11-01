import {Link, Outlet, useNavigate, useRouterState} from '@tanstack/react-router';

import {hasAbility} from '../../api';
import {SETTINGS_NAV, type SettingsNavItem} from '../../queries';
import {useMe} from '../../shared';
import {ScreenPlaceholder, Select} from '../../ui';

/**
 * Settings (`/dashboard/settings/*`). WP-23 owns this folder (Emails is WP-22's
 * `./emails`, Languages WP-25's `./languages`). The layout is F5's port of VAREL
 * `pages/admin/settings/SettingsLayout.tsx`: a grouped section nav beside the
 * section from 1100px, a section picker above it on smaller screens. Sections
 * that need an ability the person lacks are hidden (General shows read-only).
 *
 * The section screens below are STUBS: WP-23 replaces their bodies with the
 * ports of `pages/admin/settings/*` and `pages/admin/seo/*`, keeping the names.
 */
export function SettingsLayout() {
  const me = useMe();
  const abilities = me.data?.abilities;
  const pathname = useRouterState({select: s => s.location.pathname.replace(/^\/dashboard/, '').replace(/\/$/, '') || '/'});
  const navigate = useNavigate();
  const items = SETTINGS_NAV.filter(i => !i.ability || hasAbility(abilities, i.ability));
  const current = items.find(i => i.to === pathname) ?? items[0];
  const groups = [...new Set(items.map(i => i.group))].map(group => [group, items.filter(i => i.group === group)] as const);

  return (
    <div className="settings-layout">
      <nav aria-label="Settings" className="settings-nav">
        <div className="settings-nav-groups">
          {groups.map(([group, list]) => (
            <div key={group} className="settings-nav-group">
              <p className="app-nav-label">{group}</p>
              {list.map(item => (
                <Link key={item.to} to={item.to} activeOptions={{exact: true}} title={item.description} className="settings-nav-link">
                  {item.label}
                </Link>
              ))}
            </div>
          ))}
        </div>
        <div className="settings-nav-picker field">
          <label htmlFor="settings-section">Settings section</label>
          <Select
            id="settings-section"
            value={current?.to ?? '/settings'}
            options={items.map(i => ({value: i.to, label: i.label}))}
            onChange={event => void navigate({to: event.target.value as SettingsNavItem['to']})}
          />
        </div>
      </nav>
      <div className="settings-section">
        <Outlet />
      </div>
    </div>
  );
}

/** `/dashboard/settings`: Settings · General (read-only without `manageStoreSettings`). */
export function GeneralSettings() {
  return <ScreenPlaceholder title="General" description="Store name, contact, legal details, logo, social links, order numbers." />;
}

/** `/dashboard/settings/checkout`. */
export function CheckoutSettings() {
  return <ScreenPlaceholder title="Checkout" description="Guest checkout, phone, order notes, terms." />;
}

/** `/dashboard/settings/payments`. */
export function PaymentsSettings() {
  return <ScreenPlaceholder title="Payments" description="Stripe or simulated payments." />;
}

/** `/dashboard/settings/tax`. */
export function TaxSettings() {
  return <ScreenPlaceholder title="Tax and currency" description="Currency, prices with or without tax, rates by country." />;
}

/** `/dashboard/settings/shipping`. */
export function ShippingSettings() {
  return <ScreenPlaceholder title="Shipping" description="Zones are matched by the shipping country. Methods and rates show at checkout." />;
}

/** `/dashboard/settings/inventory`. */
export function InventorySettings() {
  return <ScreenPlaceholder title="Inventory and returns" description="Low stock, sold-out products, return window and reasons." />;
}

/** `/dashboard/settings/privacy`. */
export function PrivacySettings() {
  return <ScreenPlaceholder title="Customers and privacy" description="Cookie consent, reviews, analytics, abandoned bags." />;
}

/** `/dashboard/settings/seo`. */
export function SeoSettings() {
  return <ScreenPlaceholder title="SEO" description="Default title, description and share image." />;
}
