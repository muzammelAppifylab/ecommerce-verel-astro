import {useMutation, useQueryClient} from '@tanstack/react-query';
import {useState} from 'react';

import type {AdminStaffMember, StaffRoleOption} from '../../../lib/types/admin/staff';
import {ApiError} from '../../api';
import {invalidateStaff, updateStaffAccess} from '../../queries/staff';
import {Button, Drawer, ErrorNote, useToast} from '../../ui';
import {NO_ROLE} from './areas';
import {RoleChecklist} from './RoleChecklist';

/** "Edit access for {name}" (VAREL `EditDialog`): the member's store roles. Other roles stay as they are. */
export function AccessDrawer({member, roles, onClose}: {member: AdminStaffMember; roles: StaffRoleOption[]; onClose: () => void}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const storeRoles = new Set(roles.filter(r => r.areas.length > 0).map(r => r.slug));
  const [picked, setPicked] = useState<string[]>(member.roles.filter(s => storeRoles.has(s)));
  const save = useMutation({
    mutationFn: () => updateStaffAccess(member.id, picked),
    onSuccess: () => {
      void invalidateStaff(queryClient);
      toast.success(`Access updated for ${member.name}`);
      onClose();
    },
  });
  const empty = picked.length === 0;
  const fieldError = save.error instanceof ApiError ? save.error.fields.roles : undefined;

  return (
    <Drawer
      open
      onClose={onClose}
      dismissible={!save.isPending}
      title={`Edit access for ${member.name}`}
      description={`${member.email} · changes apply the next time they load a page.`}
      onSubmit={event => {
        event.preventDefault();
        if (!empty) save.mutate();
      }}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" pending={save.isPending} pendingLabel="Saving…" disabled={empty}>
            Save access
          </Button>
        </>
      }>
      <div className="form-stack">
        <RoleChecklist
          id="staff-edit-roles"
          roles={roles}
          value={picked}
          disabled={save.isPending}
          error={empty ? NO_ROLE : (fieldError ?? null)}
          onChange={next => {
            setPicked(next);
            if (save.error) save.reset();
          }}
        />
        {save.error && !fieldError && <ErrorNote error={save.error} />}
      </div>
    </Drawer>
  );
}
