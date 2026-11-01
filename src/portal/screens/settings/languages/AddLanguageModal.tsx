/* Add a language (VAREL Languages.tsx `AddLanguageDialog`). Adds the code to the store's languages
   (PATCH /site-api/manage/settings, WP-23) and can start translating everything into it at once. Only languages
   the storefront can route are offered (labels.ts ROUTABLE_LOCALES; request R3), so VAREL's free code input is
   left out until more languages are routable. */
import {useState, type FormEvent} from 'react';

import type {TranslationsStatus} from '../../../../lib/types/admin/translations';
import {ApiError} from '../../../api';
import {useUpdateLanguageSettings} from '../../../queries/languages';
import {Button, Checkbox, Field, Modal, Select, useToast} from '../../../ui';
import {CODE_RE, languageName, normCode, ROUTABLE_LOCALES} from './labels';

export function AddLanguageModal({
  open,
  onClose,
  status: s,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  status: TranslationsStatus;
  onAdded: (code: string, translateNow: boolean) => void;
}) {
  const update = useUpdateLanguageSettings();
  const toast = useToast();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(true);
  const auto = s.provider !== 'none';
  const enabled = [s.defaultLocale, ...s.locales.filter(l => l !== s.defaultLocale)];
  const available = ROUTABLE_LOCALES.filter(l => !enabled.includes(l)).map(l => ({value: l, label: `${languageName(l)} · ${l}`}));
  const c = normCode(code);

  const close = () => {
    if (update.isPending) return;
    setCode('');
    setError(null);
    onClose();
  };
  const fail = (message: string) => {
    setError(message);
    document.getElementById('add-lang')?.focus();
  };

  const add = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!CODE_RE.test(c)) return fail('Choose a language, or type a code such as nl.');
    if (enabled.includes(c)) return fail(`${languageName(c)} is already on the store.`);
    if (!ROUTABLE_LOCALES.includes(c)) return fail('Choose one of the listed languages.');
    try {
      await update.mutateAsync({locales: [...enabled, c]});
      toast.success(`${languageName(c)} added`);
      setCode('');
      setError(null);
      onAdded(c, auto && now);
    } catch (e) {
      fail(e instanceof ApiError ? (e.fields.locales ?? e.message) : 'The language could not be added. Try again.');
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      dismissible={!update.isPending}
      title="Add a language"
      description="Customers can pick it in the language switcher straight away. Untranslated text shows in the source language until it is translated."
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={update.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="add-language-form" pending={update.isPending} pendingLabel="Adding…" disabled={!c}>
            {CODE_RE.test(c) ? `Add ${languageName(c)}` : 'Add language'}
          </Button>
        </>
      }>
      <form id="add-language-form" className="lang-form" noValidate onSubmit={event => void add(event)}>
        <Field
          label="Language"
          id="add-lang"
          error={error ?? undefined}
          hint={available.length ? undefined : 'Every language the storefront can show is already on.'}>
          <Select
            id="add-lang"
            value={available.some(o => o.value === c) ? c : ''}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'add-lang-error' : undefined}
            options={[{value: '', label: 'Choose a language'}, ...available]}
            onChange={event => {
              setCode(event.target.value);
              setError(null);
            }}
          />
        </Field>
        {auto && (
          <Checkbox
            label="Translate everything now"
            description="Products, pages, menus and emails. You can review and edit each one after."
            checked={now}
            onChange={setNow}
          />
        )}
      </form>
    </Modal>
  );
}
