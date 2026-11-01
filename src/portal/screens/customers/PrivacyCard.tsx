import {useMutation, useQueryClient} from '@tanstack/react-query';
import {useNavigate} from '@tanstack/react-router';
import {useState} from 'react';

import type {CustomerExport} from '../../../lib/types/account';
import type {AdminCustomer} from '../../../lib/types/admin/customers';
import {ApiError, manage} from '../../api';
import {customerKeys} from '../../queries';
import {Button, Card, Field, Modal, Notice, useToast} from '../../ui';
import {errorText, saveJson, today} from './lib';

/**
 * "Data and privacy" (port of VAREL `PrivacyPanel.tsx`): export the customer's data, delete
 * (anonymise) the account. Shown only to viewers holding `site:user:update` (VAREL: admins).
 * VAREL's "already deleted" branch is gone: a deleted account no longer exists here.
 */
export function PrivacyCard({customer: c}: {customer: AdminCustomer}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const exporter = useMutation({
    mutationFn: () => manage<CustomerExport>(`customers/${encodeURIComponent(c.id)}/export`),
    onSuccess: data => {
      saveJson(data, `varel-customer-${c.id}-${today()}.json`);
      toast.success('Customer data exported');
    },
  });

  return (
    <Card title="Data and privacy" description="Answer access and erasure requests.">
      <div className="customers-actions">
        <Button variant="secondary" size="sm" icon="download" pending={exporter.isPending} pendingLabel="Exporting…" onClick={() => exporter.mutate()}>
          Export data
        </Button>
        {c.role === 'customer' && (
          <Button variant="danger" size="sm" icon="trash" onClick={() => setOpen(true)}>
            Delete customer
          </Button>
        )}
      </div>
      {c.role !== 'customer' && (
        <p className="muted customers-note">Staff and admin accounts must be changed to customer before they can be deleted.</p>
      )}
      {exporter.error && (
        <p className="field-error customers-note" role="alert">
          {errorText(exporter.error)}
        </p>
      )}
      {open && <DeleteCustomerDialog customer={c} onClose={() => setOpen(false)} />}
    </Card>
  );
}

function DeleteCustomerDialog({customer: c, onClose}: {customer: AdminCustomer; onClose: () => void}) {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [typed, setTyped] = useState('');
  const [tried, setTried] = useState(false);
  const matches = typed.trim().toLowerCase() === c.email.toLowerCase();

  const remove = useMutation({
    mutationFn: () => manage<null>(`customers/${encodeURIComponent(c.id)}`, {method: 'DELETE', body: {confirmEmail: typed.trim()}}),
    onSuccess: () => {
      onClose();
      toast.success('Customer deleted');
      queryClient.removeQueries({queryKey: customerKeys.detail(c.id)});
      void queryClient.invalidateQueries({queryKey: ['admin']});
      void navigate({to: '/customers'});
    },
  });

  const serverField = remove.error instanceof ApiError ? remove.error.fields.confirmEmail : undefined;
  const fieldError = serverField ?? (tried && !matches ? 'The email does not match yet.' : undefined);

  const confirm = () => {
    setTried(true);
    if (!matches) return document.getElementById('confirm-email')?.focus();
    remove.mutate();
  };

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!remove.isPending}
      size="sm"
      title={`Delete ${c.name}`}
      description="Their profile, addresses, wishlist and newsletter subscription are erased and they are signed out everywhere. Orders stay for accounting with the email masked. This cannot be undone."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={remove.isPending}>
            Cancel
          </Button>
          <Button variant="danger" pending={remove.isPending} pendingLabel="Deleting…" disabled={!matches} onClick={confirm}>
            Delete customer
          </Button>
        </>
      }>
      <form
        noValidate
        onSubmit={event => {
          event.preventDefault();
          confirm();
        }}>
        <Field
          id="confirm-email"
          label={
            <>
              Type <strong className="customers-break">{c.email}</strong> to confirm
            </>
          }
          hint={typed && !matches ? 'The email does not match yet.' : undefined}
          error={fieldError}>
          <input
            id="confirm-email"
            value={typed}
            autoComplete="off"
            spellCheck={false}
            maxLength={254}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? 'confirm-email-error' : 'confirm-email-hint'}
            onChange={event => setTyped(event.target.value)}
          />
        </Field>
      </form>
      {remove.error && !serverField && <Notice tone="danger">{errorText(remove.error)}</Notice>}
    </Modal>
  );
}
