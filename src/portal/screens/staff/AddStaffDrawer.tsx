import {useMutation, useQueryClient} from '@tanstack/react-query';
import {useState} from 'react';

import type {StaffInviteResult, StaffRoleOption} from '../../../lib/types/admin/staff';
import {ApiError} from '../../api';
import {invalidateStaff, inviteStaff} from '../../queries/staff';
import {Button, Drawer, ErrorNote, Field, useForm, useToast} from '../../ui';
import {checklistRoles, emailProblem, NO_ROLE} from './areas';
import {RoleChecklist} from './RoleChecklist';

/**
 * "Add staff" (VAREL `InviteDialog`). An email that already has an account gets the roles at once; any other
 * email is sent a link to create an account (there is no invite token: D5).
 */
export function AddStaffDrawer({
  roles,
  email: initialEmail = '',
  onClose,
  onInvited,
}: {
  roles: StaffRoleOption[];
  email?: string;
  onClose: () => void;
  onInvited: (email: string, url: string) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  // VAREL started an invite as "Staff": preselect the `staff` role when the viewer may give it.
  const preset = checklistRoles(roles).find(r => r.slug === 'staff' && r.assignable);
  const [picked, setPicked] = useState<string[]>(preset ? [preset.slug] : []);
  const [rolesError, setRolesError] = useState<string | null>(null);
  const form = useForm({email: initialEmail}, {email: [emailProblem]});

  const invite = useMutation({
    mutationFn: (email: string) => inviteStaff({email: email.trim(), roles: picked}),
    onSuccess: (r: StaffInviteResult) => {
      void invalidateStaff(queryClient);
      if (r.status === 'granted') toast.success(`${r.email} now has access`);
      else {
        toast.success(`Invite sent to ${r.email}`);
        onInvited(r.email, r.inviteUrl);
      }
      onClose();
    },
    onError: error => {
      if (error instanceof ApiError) {
        if (error.fields.email) form.setServerErrors({email: error.fields.email});
        if (error.fields.roles) setRolesError(error.fields.roles);
      }
    },
  });

  const fieldErrors = invite.error instanceof ApiError && (invite.error.fields.email || invite.error.fields.roles);
  const submit = form.submit(values => {
    if (!picked.length) {
      setRolesError(NO_ROLE);
      document.querySelector<HTMLInputElement>('#staff-add-roles input:not([disabled])')?.focus();
      return;
    }
    invite.mutate(values.email);
  });

  return (
    <Drawer
      open
      onClose={onClose}
      dismissible={!invite.isPending}
      title="Add staff"
      description="If they already have an account, they get access now. If not, we email them a link to create one; add them here once they have."
      onSubmit={event => {
        if (!picked.length) setRolesError(NO_ROLE);
        submit(event);
      }}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={invite.isPending}>
            Cancel
          </Button>
          <Button type="submit" icon="mail-plus" pending={invite.isPending} pendingLabel="Sending…">
            Send invite
          </Button>
        </>
      }>
      <div className="form-stack">
        <Field label="Email" id="f-email" error={form.error('email')}>
          <input
            {...form.field('email')}
            onChange={event => {
              form.field('email').onChange(event);
              if (invite.error) invite.reset();
            }}
            type="email"
            autoComplete="off"
            placeholder="name@varel.studio"
            maxLength={320}
          />
        </Field>
        <RoleChecklist
          id="staff-add-roles"
          roles={roles}
          value={picked}
          disabled={invite.isPending}
          error={rolesError}
          onChange={next => {
            setPicked(next);
            setRolesError(next.length ? null : NO_ROLE);
          }}
        />
        {invite.error && !fieldErrors && <ErrorNote error={invite.error} />}
      </div>
    </Drawer>
  );
}
