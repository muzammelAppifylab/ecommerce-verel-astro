import {useNavigate, useSearch} from '@tanstack/react-router';

import {type ActivitySearch, type ActivityTab} from '../../queries/activity';
import {useMe} from '../../shared';
import {LoadingBlock, PageHeader, Tabs} from '../../ui';
import {SecurityLog} from './SecurityLog';
import {StoreLog} from './StoreLog';

/**
 * `/dashboard/activity`: two logs. "Store changes" is VAREL's activity log (every admin change in words; the
 * staff area, `manageUsers`); "Sign-ins and security" is the template's audit log (`readAudit`). The tab lives
 * in the URL (`?tab=security`); with only one allowed, that log shows without tabs.
 */
export function Activity() {
  const me = useMe();
  const search = useSearch({from: '/activity'}) as ActivitySearch;
  const navigate = useNavigate({from: '/activity'});
  const abilities = me.data?.abilities as {manageUsers?: boolean; readAudit?: boolean} | undefined;
  const allowed: ActivityTab[] = [...(abilities?.manageUsers ? (['store'] as const) : []), ...(abilities?.readAudit ? (['security'] as const) : [])];
  const tab: ActivityTab = search.tab && allowed.includes(search.tab) ? search.tab : (allowed[0] ?? 'store');

  /** A filter change (VAREL `set`), or `null` to clear every filter. Replaces the history entry. */
  const setSearch = (patch: Partial<ActivitySearch> | null) =>
    void navigate({
      search: (prev: ActivitySearch) => (patch === null ? {tab: prev.tab} : {...prev, ...patch}),
      replace: true,
      resetScroll: false,
    } as never);

  const body = tab === 'security' ? <SecurityLog /> : <StoreLog search={search} onSearch={setSearch} />;

  return (
    <div className="app-page screen-activity">
      <PageHeader title="Activity" />
      {!abilities ? (
        <LoadingBlock rows={5} />
      ) : allowed.length > 1 ? (
        <Tabs
          label="Activity log"
          value={tab}
          items={[
            {value: 'store', label: 'Store changes'},
            {value: 'security', label: 'Sign-ins and security'},
          ]}
          onChange={next => void navigate({search: (prev: ActivitySearch) => ({...prev, tab: next === 'store' ? undefined : next}), replace: true} as never)}>
          {body}
        </Tabs>
      ) : (
        body
      )}
    </div>
  );
}
