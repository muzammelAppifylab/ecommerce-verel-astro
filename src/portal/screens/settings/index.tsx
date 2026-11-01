import {Link, Outlet, useNavigate, useRouterState} from '@tanstack/react-router';

import {hasAbility} from '../../api';
import {SETTINGS_NAV, type SettingsNavItem} from '../../queries';
import {useMe} from '../../shared';
import {Select} from '../../ui';

/**
 * Settings (`/dashboard/settings/*`). WP-23 owns this folder (Emails is WP-22's
 * `./emails`, Languages WP-25's `./languages`). The layout is F5's port of VAREL
 * `pages/admin/settings/SettingsLayout.tsx`: a grouped section nav beside the
 * section from 1100px, a section picker above it on smaller screens. Sections
 * that need an ability the person lacks are hidden (General shows read-only).
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

// The section screens (ports of VAREL `pages/admin/settings/*` and `pages/admin/seo/*`),
// lazy-loaded by name from `routes.tsx`.
export {GeneralSettings} from './general';
export {CheckoutSettings} from './checkout';
export {PaymentsSettings} from './payments';
export {TaxSettings} from './tax';
export {ShippingSettings} from './shipping';
export {InventorySettings} from './inventory';
export {PrivacySettings} from './privacy';
export {SeoSettings} from './seo';
