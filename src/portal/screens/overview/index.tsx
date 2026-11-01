import {useQuery} from '@tanstack/react-query';
import {useNavigate, useSearch} from '@tanstack/react-router';

import {dashboardQuery, hasStoreArea, healthQuery, reportSettingsQuery} from '../../queries';
import {useMe} from '../../shared';
import {Button, buttonClass, Card, EmptyState, ErrorNote, Icon, Notice, PageHeader, PeriodToggle} from '../../ui';
// The screen's CSS (./screen.css) is bundled by src/layouts/App.astro with every screen.css.
import {DashboardBody, DashboardSkeleton, longDate, todayText} from './Dashboard';

/**
 * `/dashboard/`: the store's overview (VAREL src/pages/admin/dashboard/Dashboard.tsx). The template's health
 * notices stay on top (owner setup, Site Key); then the dashboard for 7, 30 or 90 days or the lifetime.
 * People without any store area (a customer who reached the dashboard) get a plain "for the team" state.
 */
export function Overview() {
  const me = useMe();
  const health = useQuery(healthQuery);
  const search = useSearch({from: '/'});
  const navigate = useNavigate({from: '/'});
  const days = search.days ?? 30;
  const allowed = hasStoreArea(me.data?.abilities);
  const dashboard = useQuery({...dashboardQuery(days), enabled: allowed});
  const settings = useQuery({...reportSettingsQuery, enabled: allowed});
  const {data, isLoading, isError, isFetching, error, refetch} = dashboard;
  const currency = settings.data?.currency ?? data?.recentOrders[0]?.currency ?? 'USD';
  // The data on screen is the window asked for (not the previous one kept while the new one loads).
  const shown = data && (days === 'all' ? data.lifetime : !data.lifetime && data.periodDays === days);

  const notices = (
    <>
      {me.error && <ErrorNote error={me.error} />}
      {health.data && !health.data.ownerSetup && (
        <Notice tone="warning" title="Nobody can become this site's owner yet">
          No owner email is set. Publish the site again from the platform, or add the owner's email to ownerEmails in
          src/server/auth-settings.ts.
        </Notice>
      )}
      {health.data && !health.data.siteKey && (
        <Notice tone="info" title="Emails are not sent here">
          This copy has no Site Key, so sign-in codes and password resets are not emailed. The live site has one.
        </Notice>
      )}
    </>
  );

  if (me.data && !allowed) {
    return (
      <div className="app-page screen-overview">
        {notices}
        <Card>
          <EmptyState
            icon="lock"
            title="This area is for the studio's team"
            action={
              <>
                <a className={buttonClass({variant: 'primary'})} href="/account/">
                  Your account
                </a>{' '}
                <a className={buttonClass({variant: 'secondary'})} href="/">
                  Back to the website
                </a>
              </>
            }>
            Your account has no access to the store's dashboard.
          </EmptyState>
        </Card>
      </div>
    );
  }

  return (
    <div className="app-page screen-overview">
      <PageHeader
        title="Dashboard"
        description={
          days === 'all'
            ? `${todayText()} · everything in the studio${data?.lifetime ? ` since ${longDate(data.since)}` : ''}`
            : `${todayText()} · the last ${days} days in the studio`
        }
        actions={
          <PeriodToggle
            value={days}
            onChange={d => void navigate({search: d === 30 ? {} : {days: d}, replace: true, resetScroll: false})}
          />
        }
      />
      {notices}
      {isLoading || (!data && me.isPending) ? (
        <DashboardSkeleton />
      ) : isError && !data ? (
        <Card>
          <div className="overview-error" role="alert">
            <p>
              <Icon name="alert" size={16} />
              {error?.message || 'The dashboard could not be loaded.'}
            </p>
            <Button variant="secondary" size="sm" pending={isFetching} pendingLabel="Trying again…" onClick={() => void refetch()}>
              Try again
            </Button>
          </div>
        </Card>
      ) : data ? (
        <div className={isFetching && !shown ? 'overview-wrap is-updating' : 'overview-wrap'}>
          <DashboardBody d={data} currency={currency} />
        </div>
      ) : (
        <DashboardSkeleton />
      )}
    </div>
  );
}
