import {useMutation, useQueryClient} from '@tanstack/react-query';
import {useState} from 'react';

import type {AdminCustomer} from '../../../lib/types/admin/customers';
import {ApiError, manage} from '../../api';
import {customerKeys} from '../../queries';
import {Button, Drawer, Field, Notice, rules, useForm, useToast} from '../../ui';
import {errorText} from './lib';

/** Mirrors the server (`PATCH /site-api/manage/customers/:id`, column limits from the schema). */
const PROFILE_RULES = {
  firstName: [rules.required('Enter a first name.'), rules.maxLength(80, 'Keep the first name under 80 characters.')],
  lastName: [rules.maxLength(80, 'Keep the last name under 80 characters.')],
  phone: [rules.maxLength(40, 'Keep the phone number under 40 characters.')],
};

/** "First Last" → its parts, for an account without a profile yet. */
function namesOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return {firstName: parts[0] ?? '', lastName: parts.slice(1).join(' ')};
}

/** Edit a customer's shop profile (new: VAREL had no admin profile edit). Name and email of the account stay the template's. */
export function ProfileDrawer({customer, open, onClose}: {customer: AdminCustomer; open: boolean; onClose: () => void}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const initial = {...namesOf(customer.name === customer.email ? '' : customer.name), phone: customer.phone ?? ''};
  const form = useForm(initial, PROFILE_RULES);
  const [status, setStatus] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (values: typeof initial) =>
      manage<AdminCustomer>(`customers/${encodeURIComponent(customer.id)}`, {
        method: 'PATCH',
        body: {firstName: values.firstName.trim(), lastName: values.lastName.trim(), phone: values.phone.trim() || null},
      }),
    onSuccess: next => {
      queryClient.setQueryData(customerKeys.detail(customer.id), next);
      void queryClient.invalidateQueries({queryKey: [...customerKeys.all, 'list']});
      toast.success('Profile saved');
      onClose();
    },
    onError: error => {
      if (error instanceof ApiError && Object.keys(error.fields).length) form.setServerErrors(error.fields);
      else setStatus(errorText(error));
    },
  });

  const close = () => {
    if (save.isPending) return;
    form.reset(initial);
    setStatus(null);
    onClose();
  };

  return (
    <Drawer
      open={open}
      onClose={close}
      dismissible={!save.isPending}
      title="Edit profile"
      description={customer.email}
      onSubmit={form.submit(values => {
        setStatus(null);
        save.mutate(values);
      })}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" pending={save.isPending} pendingLabel="Saving…">
            Save profile
          </Button>
        </>
      }>
      <Field label="First name" id="f-firstName" error={form.error('firstName')}>
        <input autoComplete="off" maxLength={120} {...form.field('firstName')} />
      </Field>
      <Field label="Last name" id="f-lastName" optional error={form.error('lastName')}>
        <input autoComplete="off" maxLength={120} {...form.field('lastName')} />
      </Field>
      <Field label="Phone" id="f-phone" optional hint="For example +45 20 12 34 56" error={form.error('phone')}>
        <input type="tel" autoComplete="off" maxLength={60} {...form.field('phone')} />
      </Field>
      {status && <Notice tone="danger">{status}</Notice>}
    </Drawer>
  );
}
