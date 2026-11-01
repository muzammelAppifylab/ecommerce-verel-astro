import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {Link} from '@tanstack/react-router';
import {useState} from 'react';

import type {AdminUser} from '../../../lib/types';
import {api, read} from '../../api';
import {CUSTOMER_ROLE_LABEL, CUSTOMER_ROLES, type CustomerRole, customerKeys} from '../../queries';
import {useMe} from '../../shared';
import {Button, Modal, Notice, RadioCards, useToast} from '../../ui';
import {errorText} from './lib';

/** What each role can do, shown when choosing one (VAREL `ROLE_HELP`). */
const ROLE_HELP: Record<CustomerRole, string> = {
  customer: 'Shops on the storefront. No admin access.',
  staff: "Signs in to this admin with the Staff role's areas. Limit areas with a custom role in Roles. Cannot change roles.",
  admin: 'Full admin access to every area, including staff and roles.',
};

/** The template roles a VAREL role stands for; `member` and custom roles are left as they are. */
const MANAGED = ['staff', 'admin'];

/**
 * Change a customer's role (port of VAREL `actions.tsx` `RoleDialog`). The change goes through the
 * template's users API (`PUT /site-api/admin/users/:id/roles`), which refuses roles the viewer could
 * not grant and never removes the last owner.
 */
export function RoleDialog({
  customer,
  open,
  onClose,
}: {
  customer: {id: string; name: string; role: CustomerRole};
  open: boolean;
  onClose: () => void;
}) {
  const me = useMe();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [role, setRole] = useState<CustomerRole>(customer.role);
  const user = useQuery({
    queryKey: ['users', 'detail', customer.id],
    queryFn: () => read<{user: AdminUser}>(api.admin.users[':id'].$get({param: {id: customer.id}})),
    enabled: open,
  });
  const current = user.data?.user.roles ?? [];
  const isSelf = me.data?.viewer.id != null && String(me.data.viewer.id) === customer.id;
  const isOwner = current.includes('owner');
  const others = current.filter(slug => !['member', 'owner', ...MANAGED].includes(slug));
  const changed = role !== customer.role;

  const save = useMutation({
    mutationFn: (next: CustomerRole) => {
      const roles = current.filter(slug => !MANAGED.includes(slug));
      if (next !== 'customer') roles.push(next);
      return read<{user: AdminUser}>(api.admin.users[':id'].roles.$put({param: {id: customer.id}, json: {roles}}));
    },
    onSuccess: (_data, next) => {
      toast.success(`${customer.name} is now ${CUSTOMER_ROLE_LABEL[next].toLowerCase()}`);
      void queryClient.invalidateQueries({queryKey: customerKeys.all});
      void queryClient.invalidateQueries({queryKey: ['users']});
      onClose();
    },
  });

  const confirm = () => {
    if (!changed) return onClose();
    save.mutate(role);
  };

  const loading = user.isPending;
  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible={!save.isPending}
      title={`Change role for ${customer.name}`}
      description={`Currently ${CUSTOMER_ROLE_LABEL[customer.role].toLowerCase()}. The change applies the next time they load a page.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button pending={save.isPending} pendingLabel="Saving…" disabled={loading || isOwner || Boolean(user.error)} onClick={confirm}>
            {changed ? `Make ${CUSTOMER_ROLE_LABEL[role].toLowerCase()}` : 'Save role'}
          </Button>
        </>
      }>
      <RadioCards
        legend="Role"
        name={`role-${customer.id}`}
        columns={1}
        value={role}
        onChange={setRole}
        options={CUSTOMER_ROLES.map(r => ({
          value: r,
          title: CUSTOMER_ROLE_LABEL[r],
          description: ROLE_HELP[r],
          disabled: loading || isOwner || (isSelf && r !== 'admin'),
        }))}
      />
      {isSelf && !isOwner && <p className="muted customers-note">This is your account. You can't remove your own admin role.</p>}
      {isOwner && (
        <p className="muted customers-note">
          Owners are changed in <Link to="/users">Users</Link>.
        </p>
      )}
      {others.length > 0 && <p className="muted customers-note">They also hold {others.join(', ')}; remove those in Users.</p>}
      {user.error && <Notice tone="danger">{errorText(user.error, 'Their current roles could not be loaded.')}</Notice>}
      {save.error && <Notice tone="danger">{errorText(save.error)}</Notice>}
    </Modal>
  );
}
