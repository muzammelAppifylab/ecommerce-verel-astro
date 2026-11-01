import {queryOptions, type QueryClient} from '@tanstack/react-query';

import type {AdminStaffList, AdminStaffMember, StaffInviteInput, StaffInviteResult} from '../../lib/types/admin/staff';
import {api, read} from '../api';
import {activityKey} from './activity';

/**
 * Staff (`/dashboard/staff`). WP-26 owns this file (`/site-api/manage/staff`), on top of the template's Users
 * and Roles screens (VAREL src/lib/admin/staff.ts). People's access comes from template roles; changes go through
 * the template's role handler on the server.
 */

export const staffKey = ['manage', 'staff'] as const;

export const staffQuery = queryOptions({
  queryKey: staffKey,
  queryFn: () => read<AdminStaffList>(api.manage.staff.$get()),
});

/** The route loader: warm the team. */
export const loadStaff = (queryClient: QueryClient): Promise<void> => queryClient.ensureQueryData(staffQuery).then(() => undefined);

/** PATCH: the member's store roles (the server keeps their other roles). */
export const updateStaffAccess = (id: string, roles: string[]) =>
  read<AdminStaffMember>(api.manage.staff[':id'].$patch({param: {id}, json: {roles}}));

/** DELETE: remove admin access; the account stays, as a customer. */
export async function removeStaff(id: string): Promise<void> {
  const res = await api.manage.staff[':id'].$delete({param: {id}});
  if (!res.ok) await read(Promise.resolve(res));
}

/** POST: grant at once (existing account) or email a sign-up link. */
export const inviteStaff = (input: StaffInviteInput) => read<StaffInviteResult>(api.manage.staff.invite.$post({json: input}));

/** After any change: the team, the activity log, the template's Users list and the customers list. */
export function invalidateStaff(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({queryKey: staffKey}),
    queryClient.invalidateQueries({queryKey: activityKey}),
    queryClient.invalidateQueries({queryKey: ['users']}),
    queryClient.invalidateQueries({queryKey: ['audit']}),
    queryClient.invalidateQueries({queryKey: ['manage', 'customers']}),
  ]);
}
