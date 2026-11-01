/* /dashboard/navigation — header and footer menus, and the home hero.
   Port of VAREL `src/pages/admin/navigation/Navigation.tsx` on the portal kit. */
import {useQuery} from '@tanstack/react-query';

import {meQuery} from '../../queries';
import {menusQuery} from '../../queries/navigation';
import {hasAbility} from '../../api';
import {Button, Notice, PageHeader, Skeleton} from '../../ui';
import {HeroEditor} from './HeroEditor';
import {MenuEditor} from './MenuEditor';

export function Navigation() {
  const menus = useQuery(menusQuery);
  const me = useQuery(meQuery);
  const canContent = hasAbility(me.data?.abilities, 'manageContent');
  const canSettings = hasAbility(me.data?.abilities, 'manageStoreSettings');

  return (
    <div className="cms-screen">
      <PageHeader title="Navigation" description="Header and footer links, and the hero at the top of the home page." />
      {me.data && !canSettings && <Notice tone="info">The home hero is view only. Changing it needs the settings permission.</Notice>}

      <section aria-labelledby="nav-menus" className="cms-section">
        <h3 id="nav-menus" className="cms-section-title">
          Menus
        </h3>
        {menus.error && !menus.data ? (
          <Notice
            tone="danger"
            title="The menus did not load."
            action={
              <Button variant="secondary" size="sm" pending={menus.isRefetching} pendingLabel="Trying…" onClick={() => void menus.refetch()}>
                Try again
              </Button>
            }>
            {menus.error.message}
          </Notice>
        ) : menus.isPending ? (
          <div className="cms-menu-grid" aria-busy="true" role="status" aria-label="Loading menus">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="card-panel cms-menu-skeleton">
                <Skeleton lines={6} />
              </div>
            ))}
          </div>
        ) : (
          <div className="cms-menu-grid">
            {menus.data.map(m => (
              <MenuEditor key={m.key} menu={m} readOnly={!canContent} />
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="nav-hero" className="cms-section">
        <h3 id="nav-hero" className="cms-section-title">
          Home page
        </h3>
        <HeroEditor readOnly={!canSettings} />
      </section>
    </div>
  );
}
