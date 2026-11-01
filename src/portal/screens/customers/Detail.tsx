import {useQuery} from '@tanstack/react-query';
import {getRouteApi, Link} from '@tanstack/react-router';
import {useEffect, useState} from 'react';

import {money} from '../../../lib/format';
import type {AdminCustomer} from '../../../lib/types/admin/customers';
import type {AdminOrderRow} from '../../../lib/types/admin/sales';
import {ApiError} from '../../api';
import {CUSTOMER_ROLE_LABEL, customerQuery} from '../../queries';
import {useMe} from '../../shared';
import {
  Button,
  buttonClass,
  Card,
  type Column,
  DataTable,
  DefinitionList,
  EmptyState,
  ErrorNote,
  Icon,
  LoadingBlock,
  PageHeader,
  Stat,
  StatusBadge,
} from '../../ui';
import {formatDate, formatDateTime, plural} from './lib';
import {PrivacyCard} from './PrivacyCard';
import {ProfileDrawer} from './ProfileDrawer';
import {RoleDialog} from './RoleDialog';
import {FULFILMENT_TONES, PAYMENT_TONES, ROLE_TONES} from './tones';

/** The server reads at most this many wishlist pieces (no count()): "100+" at the cap. */
const WISHLIST_CAP = 100;

const route = getRouteApi('/customers/$id');

const ORDER_COLUMNS: Column<AdminOrderRow>[] = [
  {
    key: 'number',
    header: 'Order',
    width: 'shrink',
    cell: o => (
      <Link to="/orders/$number" params={{number: o.number}} className="nowrap">
        {o.number}
      </Link>
    ),
  },
  {key: 'placedAt', header: 'Placed', cell: o => <span className="muted nowrap">{formatDateTime(o.placedAt)}</span>},
  {key: 'payment', header: 'Payment', width: 'shrink', cell: o => <StatusBadge tone={PAYMENT_TONES[o.payment] ?? 'neutral'}>{o.payment}</StatusBadge>},
  {
    key: 'fulfillment',
    header: 'Fulfilment',
    width: 'shrink',
    cell: o => <StatusBadge tone={FULFILMENT_TONES[o.fulfillment] ?? 'neutral'}>{o.fulfillment}</StatusBadge>,
  },
  {key: 'items', header: 'Items', align: 'end', width: 'shrink', cell: o => o.count},
  {key: 'total', header: 'Total', align: 'end', width: 'shrink', cell: o => money(o.total, o.currency)},
];

const BackLink = () => (
  <Link to="/customers" className={`${buttonClass({variant: 'link', size: 'sm'})} customers-back`}>
    <Icon name="arrow-left" size={16} />
    Customers
  </Link>
);

/** `/dashboard/customers/$id` (port of VAREL `pages/admin/customers/CustomerDetail.tsx`). */
export function CustomerDetail() {
  const {id} = route.useParams();
  const customer = useQuery(customerQuery(id));

  // VAREL titled the tab "<name> · Customers"; the shell sets "Customer" first, this refines it once loaded.
  const name = customer.data?.name;
  useEffect(() => {
    if (!name) return;
    const previous = document.title;
    const [, ...rest] = previous.split(' · ');
    document.title = [`${name} · Customers`, ...rest.slice(-1)].join(' · ');
    return () => {
      document.title = previous;
    };
  }, [name]);

  if (customer.isPending) {
    return (
      <div className="app-page screen-customers">
        <BackLink />
        <LoadingBlock rows={6} />
      </div>
    );
  }
  if (!customer.data) {
    const missing = customer.error instanceof ApiError && (customer.error.status === 404 || customer.error.status === 422);
    return (
      <div className="app-page screen-customers">
        <BackLink />
        <PageHeader title="Customer" />
        {missing ? (
          <EmptyState
            icon="users"
            title="There is no customer with this ID"
            action={
              <Link to="/customers" className={buttonClass({variant: 'secondary'})}>
                Back to customers
              </Link>
            }
          />
        ) : (
          <Card>
            <ErrorNote error={customer.error ?? new Error('Something went wrong.')} title="This customer could not be loaded" />
            <div className="customers-retry">
              <Button variant="secondary" size="sm" icon="refresh" onClick={() => void customer.refetch()}>
                Try again
              </Button>
            </div>
          </Card>
        )}
      </div>
    );
  }
  return <CustomerView customer={customer.data} />;
}

function CustomerView({customer: c}: {customer: AdminCustomer}) {
  const me = useMe();
  const canChangeUsers = Boolean(me.data?.abilities.updateUsers);
  const [editing, setEditing] = useState(false);
  const [roleOpen, setRoleOpen] = useState(false);
  const average = c.orders > 0 ? Math.round((c.spent / c.orders) * 100) / 100 : 0;
  const more = c.orders > c.recentOrders.length;
  const wishlist = c.wishlistCount >= WISHLIST_CAP ? `${WISHLIST_CAP}+` : String(c.wishlistCount);

  return (
    <div className="app-page screen-customers">
      <BackLink />
      <PageHeader
        title={c.name}
        description={
          <span className="customers-headline">
            <span>
              {c.email} · Customer since {c.since}
            </span>
            <StatusBadge tone={ROLE_TONES[c.role]}>{CUSTOMER_ROLE_LABEL[c.role]}</StatusBadge>
          </span>
        }
        actions={
          <>
            <a className={buttonClass({variant: 'secondary', size: 'sm'})} href={`mailto:${c.email}`}>
              <Icon name="mail" size={16} />
              Email
            </a>
            {c.orders > 0 && (
              <Link to="/orders" search={{q: c.email}} className={buttonClass({variant: 'secondary', size: 'sm'})}>
                <Icon name="shopping-bag" size={16} />
                All orders
              </Link>
            )}
          </>
        }
      />

      <div className="customers-stats">
        <Stat label="Orders" value={c.orders} hint={c.lastOrderAt ? `Last ${formatDate(c.lastOrderAt)}` : 'No orders yet'} />
        <Stat label="Lifetime spend" value={money(c.spent)} />
        <Stat label="Average order" value={c.orders ? money(average) : '—'} />
        <Stat label="Wishlist" value={wishlist} hint={`${plural(c.wishlistCount, 'piece')} saved`} />
      </div>

      <div className="customers-columns">
        <div className="customers-column">
          <Card
            title="Recent orders"
            description={more ? `Latest ${c.recentOrders.length} of ${c.orders}` : undefined}
            actions={
              more && (
                <Link to="/orders" search={{q: c.email}} className={buttonClass({variant: 'link', size: 'sm'})}>
                  View all {plural(c.orders, 'order')}
                  <Icon name="external" size={14} />
                </Link>
              )
            }
            flush>
            <DataTable
              caption="Recent orders"
              columns={ORDER_COLUMNS}
              rows={c.recentOrders}
              rowKey={o => o.number}
              empty={<p className="muted customers-empty">No orders yet.</p>}
            />
          </Card>

          <Card title="Addresses">
            {c.addresses.length === 0 ? (
              <p className="muted customers-empty">No saved addresses.</p>
            ) : (
              <div className="customers-addresses">
                {c.addresses.map(a => (
                  <address key={a.id} className="customers-address">
                    <span className="customers-address-label">
                      {a.label ?? 'Address'}
                      {a.primary && <span className="customers-address-primary"> · Primary</span>}
                    </span>
                    <span>{a.name}</span>
                    <span>{a.line1}</span>
                    {a.line2 && <span>{a.line2}</span>}
                    <span>
                      {a.zip} {a.city}
                    </span>
                    <span>{a.country}</span>
                    {a.phone && <span className="muted">{a.phone}</span>}
                  </address>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="customers-column">
          <Card
            title="Profile"
            actions={
              <Button variant="secondary" size="sm" icon="pencil" onClick={() => setEditing(true)}>
                Edit
              </Button>
            }>
            <DefinitionList
              items={[
                {label: 'Name', value: c.name},
                {
                  label: 'Email',
                  value: (
                    <a href={`mailto:${c.email}`} className="customers-break">
                      {c.email}
                    </a>
                  ),
                },
                {label: 'Phone', value: c.phone ?? '—'},
                {label: 'Joined', value: formatDate(c.createdAt)},
                {label: 'Newsletter', value: c.newsletter ? 'Subscribed' : 'Not subscribed'},
              ]}
            />
          </Card>

          <Card
            title="Role"
            description="Staff and admins can sign in to this admin."
            actions={<StatusBadge tone={ROLE_TONES[c.role]}>{CUSTOMER_ROLE_LABEL[c.role]}</StatusBadge>}>
            {canChangeUsers ? (
              <Button variant="secondary" size="sm" onClick={() => setRoleOpen(true)}>
                Change role
              </Button>
            ) : (
              <p className="muted customers-note">Only admins can change roles.</p>
            )}
          </Card>

          {canChangeUsers && <PrivacyCard customer={c} />}
        </div>
      </div>

      {editing && <ProfileDrawer customer={c} open onClose={() => setEditing(false)} />}
      {roleOpen && <RoleDialog customer={c} open onClose={() => setRoleOpen(false)} />}
    </div>
  );
}
