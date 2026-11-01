import {type FormEvent, useEffect, useId, useState} from 'react';

import {ApiError} from '../../api';
import {Button, Field, Modal, Notice} from '../../ui';

/** Mirrors the server (`src/server/routes/admin/taxonomy.ts`): 1–80 characters, at least one letter or digit. */
export function nameProblem(raw: string): string | null {
  const name = raw.trim();
  if (!name) return 'Enter a name';
  if (name.length > 80) return 'Keep the name under 80 characters';
  if (!/[\p{L}\p{N}]/u.test(name)) return 'Use at least one letter or number';
  return null;
}

/**
 * The name of a department or category: add or rename. Replaces VAREL's inline add / rename
 * forms with a labelled field (AGENTS.md forms). An unchanged or empty rename closes without a
 * request; the server's 422 / 409 field errors land on the field.
 */
export function NameModal({
  open,
  title,
  description,
  initial = '',
  submitLabel,
  pendingLabel,
  hint,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  description?: string;
  initial?: string;
  submitLabel: string;
  pendingLabel: string;
  hint?: string;
  onClose: () => void;
  /** Resolves when saved (the modal closes), rejects with the server's error. */
  onSubmit: (name: string) => Promise<unknown>;
}) {
  const id = useId();
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(initial);
    setError(null);
    setFormError(null);
    setTried(false);
    setPending(false);
  }, [open, initial]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    const value = name.trim();
    if (initial && value === initial.trim()) return onClose();
    const problem = nameProblem(value);
    setError(problem);
    if (problem) {
      document.getElementById(`${id}-name`)?.focus();
      return;
    }
    setPending(true);
    setFormError(null);
    try {
      await onSubmit(value);
      setPending(false);
      onClose();
    } catch (e) {
      setPending(false);
      if (e instanceof ApiError && e.fields.name) {
        setError(e.fields.name);
        document.getElementById(`${id}-name`)?.focus();
      } else setFormError(e instanceof Error ? e.message : 'That did not work. Try again.');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible={!pending}
      size="sm"
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form={`${id}-form`} pending={pending} pendingLabel={pendingLabel}>
            {submitLabel}
          </Button>
        </>
      }>
      <form id={`${id}-form`} onSubmit={e => void submit(e)} noValidate>
        <Field id={`${id}-name`} label="Name" hint={hint} error={error ?? undefined}>
          <input
            id={`${id}-name`}
            autoFocus
            autoComplete="off"
            maxLength={120}
            value={name}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-name-error` : hint ? `${id}-name-hint` : undefined}
            onChange={e => {
              setName(e.target.value);
              if (tried) setError(nameProblem(e.target.value));
            }}
            onBlur={() => name && setError(nameProblem(name))}
          />
        </Field>
        {formError && <Notice tone="danger">{formError}</Notice>}
      </form>
    </Modal>
  );
}
