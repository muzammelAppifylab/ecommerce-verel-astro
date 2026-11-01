import {useQuery} from '@tanstack/react-query';
import {useNavigate, useSearch} from '@tanstack/react-router';
import {useCallback} from 'react';

import {emailCountsQuery, emailDeliveryQuery, type EmailsSearch, type EmailsTab} from '../../../queries/emails';
import {PageHeader, Tabs} from '../../../ui';
import {Delivery} from './Delivery';
import {PROVIDER_LABEL} from './labels';
import {Messages} from './Messages';
import {Templates} from './Templates';

/**
 * `/dashboard/settings/emails`: the transactional templates (editor with live preview), the message log / outbox, and
 * delivery (provider, sender, staff alerts). One place for everything the store sends. WP-22: port of VAREL
 * src/pages/admin/emails/Emails.tsx (hand-made tablist → kit `Tabs`; the tab lives in `?tab=`).
 */
export function Emails() {
  const search = useSearch({from: '/settings/emails'});
  const navigate = useNavigate();
  const tab: EmailsTab = search.tab ?? 'templates';
  const delivery = useQuery(emailDeliveryQuery).data;
  const counts = useQuery(emailCountsQuery).data;

  const set = useCallback(
    (patch: Partial<EmailsSearch>) =>
      void navigate({to: '/settings/emails', search: {...search, ...patch}, replace: true, resetScroll: false}),
    [navigate, search]
  );

  const provider = delivery?.emailProvider ?? 'outbox';
  const failed = counts?.failed ?? 0;
  const failedLabel = counts?.capped.includes('failed') ? '100+' : String(failed);

  return (
    <div className="screen-emails">
      <PageHeader
        title="Emails"
        description={
          delivery
            ? provider === 'outbox'
              ? 'Emails are kept in the outbox and not delivered yet. Choose a provider under Delivery to send them.'
              : `Delivered through ${PROVIDER_LABEL[provider]} from ${delivery.emailFromName} <${delivery.emailFromAddress}>.`
            : 'What the store sends, what it has sent, and how it is delivered.'
        }
      />
      <Tabs
        label="Emails"
        value={tab}
        onChange={next => void navigate({to: '/settings/emails', search: {tab: next === 'templates' ? undefined : next, key: search.key}, replace: true})}
        items={[
          {value: 'templates', label: 'Templates'},
          {
            value: 'messages',
            label: (
              <>
                {provider === 'outbox' ? 'Outbox' : 'Sent'}
                {failed > 0 && (
                  <span className="emails-failed-count">
                    {failedLabel}
                    <span className="visually-hidden"> failed</span>
                  </span>
                )}
              </>
            ),
          },
          {value: 'delivery', label: 'Delivery'},
        ]}>
        {tab === 'templates' ? (
          <Templates search={search} set={set} />
        ) : tab === 'messages' ? (
          <Messages search={search} set={set} />
        ) : (
          <Delivery />
        )}
      </Tabs>
    </div>
  );
}
