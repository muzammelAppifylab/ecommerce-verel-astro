import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {Link, useNavigate} from '@tanstack/react-router';
import {useState} from 'react';

import type {AdminStaffMember, StaffInvitation} from '../../../lib/types/admin/staff';
import {invalidateStaff, removeStaff, staffQuery} from '../../queries/staff';
import {ago, pageCount, when} from '../../shared';
import {
  Badge,
  Button,
  buttonClass,
  Card,
  type Column,
  DataTable,
  EmptyState,
  ErrorNote,
  IconButton,
  Menu,
  type MenuItem,
  Notice,
  PageHeader,
  StatusBadge,
  useConfirm,
  useToast,
} from '../../ui';
import {AccessDrawer} from './AccessDrawer';
import {AddStaffDrawer} from './AddStaffDrawer';
import {AreaList} from './RoleChecklist';

/**
 * `/dashboard/staff` (VAREL src/pages/admin/staff/StaffPage.tsx): the people who run the store, with their
 * template roles and the areas those roles grant. Access changes go through the template's role handler (the
 * server forwards them), so nobody hands out more than they hold. Invites grant at once to an existing account,
 * or email a link to the sign-up page.
 */

const people = (n: string | null, more: boolean) => `${n ?? 0} ${n === '1' && !more ? 'person' : 'people'}`;
const fullDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, {day: 'numeric', month: 'short', year: 'numeric'});

function copyLink(url: string, toast: ReturnType<typeof useToast>) {
  if (!navigator.clipboard) return toast.info('Copy the link from the field');
  navigator.clipboard
    .writeText(url)
    .then(() => toast.success('Invite link copied'))
    .catch(() => toast.info('Copy the link from the field'));
}

export function StaffPage() {
  const staff = useQuery(staffQuery);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();
  const [adding, setAdding] = useState<{email: string} | null>(null);
  const [editing, setEditing] = useState<AdminStaffMember | null>(null);
  const [link, setLink] = useState<{email: string; url: string} | null>(null);

  const remove = useMutation({
    mutationFn: (m: AdminStaffMember) => removeStaff(m.id),
    onSettled: () => void invalidateStaff(queryClient),
  });
  const busyId = remove.isPending ? (remove.variables?.id ?? null) : null;

  const data = staff.data;
  const canEdit = Boolean(data?.canEdit);
  const roleName = new Map(data?.roles.map(r => [r.slug, r.name]));

  const askRemove = async (m: AdminStaffMember) => {
    const done = await confirm({
      title: `Remove ${m.name} from the team`,
      body: 'They keep their account and order history, but can no longer open the admin.',
      confirmLabel: 'Remove access',
      pendingLabel: 'Removing…',
      tone: 'danger',
      action: () => remove.mutateAsync(m),
    });
    if (done) toast.success(`${m.name} no longer has admin access`);
  };

  const why = (m: AdminStaffMember) =>
    m.isYou
      ? 'You cannot change your own access'
      : m.isOwner
        ? 'Owners are set by the platform'
        : 'Only someone with every permission this person has can change them';

  const memberColumns: Column<AdminStaffMember>[] = [
    {
      key: 'name',
      header: 'Name',
      cell: m => (
        <span className="staff-person">
          <span className="staff-person-name">
            {m.name}
            {m.isYou && <span className="muted">You</span>}
            {m.status === 'suspended' && <StatusBadge tone="warning">Suspended</StatusBadge>}
          </span>
          <span className="muted">{m.email}</span>
        </span>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      cell: m => (
        <span className="badges">
          {m.roles
            .filter(s => s !== 'member')
            .map(s => (
              <Badge key={s} tone={s === 'owner' ? 'brand' : 'neutral'}>
                {roleName.get(s) ?? s}
              </Badge>
            ))}
        </span>
      ),
    },
    {key: 'areas', header: 'Access', cell: m => <AreaList areas={m.areas} />},
    {
      key: 'last',
      header: 'Last activity',
      width: 'shrink',
      hideOnMobile: true,
      cell: m =>
        m.lastActiveAt ? (
          <time className="muted nowrap" dateTime={m.lastActiveAt}>
            {when(m.lastActiveAt)}
          </time>
        ) : (
          <span className="muted">—</span>
        ),
    },
    {
      key: 'since',
      header: 'Joined',
      width: 'shrink',
      hideOnMobile: true,
      cell: m => (
        <time className="muted nowrap" dateTime={m.createdAt}>
          {fullDate(m.createdAt)}
        </time>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      actions: true,
      cell: m => {
        if (!m.manageable) return <span className="visually-hidden">{why(m)}</span>;
        const items: MenuItem[] = [
          {label: 'Edit access…', icon: 'pencil', onSelect: () => setEditing(m)},
          {label: 'View activity', icon: 'activity', onSelect: () => void navigate({to: '/activity', search: {actor: m.id}})},
          'separator',
          {label: 'Remove access…', icon: 'ban', danger: true, onSelect: () => void askRemove(m)},
        ];
        return <Menu label={`Actions for ${m.name}`} items={items} disabled={busyId === m.id} />;
      },
    },
  ];

  const inviteColumns: Column<StaffInvitation>[] = [
    {key: 'email', header: 'Email', cell: i => i.email},
    {key: 'by', header: 'Invited by', cell: i => <span className="muted">{i.invitedBy}</span>},
    {
      key: 'at',
      header: 'Sent',
      width: 'shrink',
      cell: i => (
        <time className="muted nowrap" dateTime={i.at} title={when(i.at)}>
          {ago(i.at)}
        </time>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 'shrink',
      cell: i =>
        i.hasAccount ? <StatusBadge tone="success">Has an account</StatusBadge> : <StatusBadge tone="neutral">Waiting for sign-up</StatusBadge>,
    },
  ];
  if (canEdit)
    inviteColumns.push({
      key: 'actions',
      header: 'Actions',
      actions: true,
      cell: i => (
        <Button size="sm" variant="secondary" icon={i.hasAccount ? 'user-plus' : 'refresh'} onClick={() => setAdding({email: i.email})}>
          {i.hasAccount ? 'Add to team' : 'Send again'}
        </Button>
      ),
    });

  const count = pageCount(data?.members, Boolean(data?.truncated));
  const invitations = data?.invitations ?? [];
  const description = data
    ? `${people(count, Boolean(data.truncated))}${
        invitations.length ? ` · ${invitations.length} recent ${invitations.length === 1 ? 'invitation' : 'invitations'}` : ''
      }`
    : undefined;

  return (
    <div className="app-page screen-staff">
      <PageHeader
        title="Staff"
        description={description}
        actions={
          <>
            <Link to="/activity" className={buttonClass({variant: 'secondary'})}>
              Activity
            </Link>
            {canEdit && (
              <Button icon="user-plus" onClick={() => setAdding({email: ''})}>
                Add staff
              </Button>
            )}
          </>
        }
      />

      {link && (
        <Notice tone="info" action={<IconButton icon="x" label="Dismiss" size="sm" onClick={() => setLink(null)} />}>
          <p>
            Invite sent to <strong>{link.email}</strong>. You can also share this link: it opens the sign-up page.
          </p>
          <div className="staff-link">
            <label className="visually-hidden" htmlFor="staff-invite-link">
              Invite link
            </label>
            <input id="staff-invite-link" readOnly value={link.url} onFocus={event => event.currentTarget.select()} />
            <Button size="sm" variant="secondary" icon="copy" onClick={() => copyLink(link.url, toast)}>
              Copy
            </Button>
          </div>
        </Notice>
      )}

      {staff.error && !data ? (
        <Card>
          <div className="form-stack">
            <ErrorNote error={staff.error} title="Staff could not be loaded" />
            <div>
              <Button variant="secondary" icon="refresh" pending={staff.isFetching} pendingLabel="Trying…" onClick={() => void staff.refetch()}>
                Try again
              </Button>
            </div>
          </div>
        </Card>
      ) : (
        <>
          {data?.truncated && <Notice tone="warning">Showing the first 100 people. Use Users to find someone else.</Notice>}
          <Card title="Team" flush>
            <DataTable
              caption="Team"
              columns={memberColumns}
              rows={data?.members}
              rowKey={m => m.id}
              loading={staff.isPending}
              busyKey={busyId}
              empty={
                <EmptyState
                  icon="users"
                  title="No staff yet"
                  action={
                    canEdit ? (
                      <Button icon="user-plus" onClick={() => setAdding({email: ''})}>
                        Add staff
                      </Button>
                    ) : undefined
                  }>
                  Invite someone to get started.
                </EmptyState>
              }
            />
          </Card>

          {invitations.length > 0 && (
            <Card title="Recent invitations" description="Sent in the last 30 days. Add people once they have created their account." flush>
              <DataTable caption="Recent invitations" columns={inviteColumns} rows={invitations} rowKey={i => i.email} />
            </Card>
          )}

          <Card>
            <p className="staff-explainer">
              Owners and admins have every area. Staff see only the areas their roles include; everyone with an area can open the
              dashboard. Changes apply on their next page load. Every change in the admin is recorded in the{' '}
              <Link to="/activity">activity log</Link>. To give someone a different mix of areas, <Link to="/roles">create a role</Link>{' '}
              and add it here.
            </p>
          </Card>
        </>
      )}

      {adding && data && (
        <AddStaffDrawer
          key={adding.email}
          roles={data.roles}
          email={adding.email}
          onClose={() => setAdding(null)}
          onInvited={(email, url) => setLink({email, url})}
        />
      )}
      {editing && data && <AccessDrawer key={editing.id} member={editing} roles={data.roles} onClose={() => setEditing(null)} />}
    </div>
  );
}
