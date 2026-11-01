import {useQuery} from '@tanstack/react-query';
import {useBlocker} from '@tanstack/react-router';
import {type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState} from 'react';

import type {StoreSettings} from '../../../lib/types/admin/store';
import {ApiError, hasAbility} from '../../api';
import {settingsQuery, useUpdateSettings} from '../../queries/settings';
import {useMe} from '../../shared';
import {Button, Card, EmptyState, Icon, LoadingBlock, Notice, PageHeader, Switch, useConfirm, useToast} from '../../ui';

/**
 * Shared pieces of the settings sections (port of VAREL `pages/admin/settings/shared.tsx` and
 * `ReadOnlyNote.tsx`): access, the draft / save model, the page shell and form rows. Each section
 * declares how StoreSettings maps to its form, how the form maps back, and its rules; saves PATCH
 * /site-api/manage/settings with only the fields that changed.
 *
 * Public API for other packages (WP-04, WP-07, WP-16, WP-22, WP-24, WP-25): `useCanEditSettings`,
 * `useSettingsDraft`, `SettingsShell` (`embedded` for a tab), `Section`, `ToggleRow`, `ReadOnlyNote`,
 * `firstProblem`, `fieldAria`, the validation helpers. Keep these signatures.
 */

// ─── Access ───────────────────────────────────────────────────────────────────

/** True when the signed-in person may change store settings (UI only: the routes enforce it). */
export function useCanEditSettings(): boolean {
  return hasAbility(useMe().data?.abilities, 'manageStoreSettings');
}

/** The useful part of an error: a validation error's first field message, else its message. */
export function firstProblem(error: unknown): string {
  if (error instanceof ApiError) {
    const first = Object.values(error.fields)[0];
    if (first && (error.status === 422 || !error.message)) return first;
    return error.message;
  }
  if (error instanceof Error && error.message) return error.message;
  return 'That did not work. Try again.';
}

// ─── Defaults (fields an older API might not return) ──────────────────────────

export const SETTINGS_DEFAULTS: Omit<StoreSettings, 'storeName' | 'supportEmail' | 'homeHero' | 'secrets'> = {
  currency: 'USD',
  taxName: 'VAT',
  taxRate: 0.25,
  freeShippingThreshold: 150,
  announcement: '',
  lowStockThreshold: 6,
  returnWindowDays: 30,
  pricesIncludeTax: false,
  taxDigital: true,
  taxShipping: false,
  legalName: '',
  vatNumber: '',
  businessAddress: '',
  phone: '',
  logoUrl: null,
  socialLinks: {},
  orderPrefix: 'VRL-',
  guestCheckout: true,
  requirePhone: false,
  orderNotes: true,
  termsText: '',
  hideSoldOut: false,
  returnReasons: [],
  refundShipping: false,
  paymentProvider: 'simulated',
  stripePublishableKey: null,
  emailProvider: 'outbox',
  emailConfig: {},
  emailFromName: '',
  emailFromAddress: '',
  emailReplyTo: null,
  staffAlertEmail: null,
  seoTitle: '',
  seoDescription: '',
  ogImage: null,
  cookieConsent: false,
  abandonedCartEnabled: false,
  abandonedCartHours: 24,
  reviewsEnabled: true,
  reviewsRequireApproval: true,
  reviewsVerifiedOnly: false,
  analyticsEnabled: false,
  defaultLocale: 'en',
  locales: ['en', 'da', 'de', 'fr', 'es', 'sv'],
  translationProvider: 'workers-ai',
  autoTranslate: true,
};

export function withDefaults(s: StoreSettings): StoreSettings {
  const out = {...SETTINGS_DEFAULTS, ...s} as StoreSettings;
  for (const k of Object.keys(SETTINGS_DEFAULTS) as (keyof typeof SETTINGS_DEFAULTS)[]) {
    if (s[k] === undefined) (out as unknown as Record<string, unknown>)[k] = SETTINGS_DEFAULTS[k];
  }
  return out;
}

// ─── Draft model ──────────────────────────────────────────────────────────────

export type Errors = Record<string, string>;

export interface SettingsCodec<F> {
  toForm: (s: StoreSettings) => F;
  /** The full set of settings this page edits, from the form (diffed against the server copy on save). */
  toValues: (f: F) => Partial<StoreSettings>;
  validate: (f: F) => Errors;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Only the fields that differ from the server copy. */
export function diff(values: Partial<StoreSettings>, base: StoreSettings): Partial<StoreSettings> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (!same(v, (base as unknown as Record<string, unknown>)[k])) out[k] = v;
  }
  return out as Partial<StoreSettings>;
}

/** An error key belongs to a form key when it is the key or one of its parts (`socialLinks.x` → `socialLinks`). */
const keyOf = (errorKey: string) => errorKey.split('.')[0]!;

/**
 * The draft of one settings section. Errors show after a field is left (`touch(key)`) or after a
 * submit, then update live while typing; server field errors (`422 fields`) land on their fields and
 * clear when that field is edited. `formError` is the form's status line ("Check the highlighted fields.").
 */
export function useSettingsDraft<F>(codec: SettingsCodec<F>) {
  const canWrite = useCanEditSettings();
  const query = useQuery(settingsQuery);
  const data = useMemo(() => (query.data ? withDefaults(query.data) : undefined), [query.data]);
  const save = useUpdateSettings();
  const toast = useToast();
  const [f, setF] = useState<F | null>(null);
  const [serverErrors, setServerErrors] = useState<Errors>({});
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const codecRef = useRef(codec);
  codecRef.current = codec;

  // Reset the form whenever the server copy changes (first load, after a save).
  useEffect(() => {
    if (data) setF(codecRef.current.toForm(data));
  }, [data]);

  const patch = useMemo(() => (f && data ? diff(codecRef.current.toValues(f), data) : {}), [f, data]);
  const changed = Object.keys(patch).length;
  const dirty = canWrite && changed > 0;

  const clientErrors = useMemo(() => (f ? codecRef.current.validate(f) : {}), [f]);
  const errors = useMemo(() => {
    const shown: Errors = {};
    for (const [k, message] of Object.entries(clientErrors)) {
      if (submitted || touched.has(k) || touched.has(keyOf(k))) shown[k] = message;
    }
    return {...shown, ...serverErrors};
  }, [clientErrors, serverErrors, submitted, touched]);

  const set = (p: Partial<F>) => {
    setF(prev => (prev ? {...prev, ...p} : prev));
    setFormError(null);
    // A server error clears as soon as its field is edited.
    const keys = Object.keys(p);
    setServerErrors(e => {
      const left = Object.fromEntries(Object.entries(e).filter(([k]) => !keys.includes(keyOf(k)) && !keys.includes(k)));
      return Object.keys(left).length === Object.keys(e).length ? e : left;
    });
  };

  /** Show a field's error once it has been left (onBlur). */
  const touch = useCallback((key: string) => setTouched(prev => (prev.has(key) ? prev : new Set(prev).add(key))), []);

  async function submit(): Promise<boolean> {
    if (!f || !dirty || save.isPending) return false;
    setSubmitted(true);
    if (Object.keys(clientErrors).length) {
      setFormError('Check the highlighted fields.');
      return false;
    }
    setFormError(null);
    try {
      await save.mutateAsync(patch);
      setSavedAt(new Date());
      setServerErrors({});
      setSubmitted(false);
      setTouched(new Set());
      toast.success('Settings saved');
      return true;
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) {
        setServerErrors(err.fields);
        setFormError('Check the highlighted fields.');
      } else {
        setFormError(firstProblem(err));
      }
      return false;
    }
  }

  const discard = () => {
    if (data) setF(codecRef.current.toForm(data));
    setServerErrors({});
    setSubmitted(false);
    setTouched(new Set());
    setFormError(null);
  };

  return {
    f,
    set,
    touch,
    data,
    errors,
    /** Put field errors on the form (e.g. a server answer handled by the caller). */
    setErrors: setServerErrors,
    formError,
    patch,
    changed,
    dirty,
    submit,
    discard,
    saving: save.isPending,
    savedAt,
    ro: !canWrite,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

export type SettingsDraft<F> = ReturnType<typeof useSettingsDraft<F>>;

/** `aria-invalid` + `aria-describedby` for a control inside a kit `Field` with this `id`. */
export const fieldAria = (id: string, error?: string) => ({
  'aria-invalid': error ? true : undefined,
  'aria-describedby': error ? `${id}-error` : `${id}-hint`,
});

// ─── Page shell ───────────────────────────────────────────────────────────────

const timeOf = (d: Date) => d.toLocaleTimeString('en-GB', {hour: '2-digit', minute: '2-digit'});

/** Shown to people who may view but not change these settings. */
export function ReadOnlyNote({children = 'View only. You need the settings permission to change these.'}: {children?: ReactNode}) {
  return <Notice tone="info">{children}</Notice>;
}

export function SettingsShell<F>({
  title,
  description,
  draft,
  embedded,
  children,
}: {
  title: string;
  description: ReactNode;
  draft: SettingsDraft<F>;
  /** Inside another page (a tab of Emails or Languages): no page header; the description and the save actions sit in one row. */
  embedded?: boolean;
  children: (f: F) => ReactNode;
}) {
  const {dirty, saving, ro, f, error, isLoading} = draft;
  const formRef = useRef<HTMLFormElement>(null);
  const confirm = useConfirm();
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  useBlocker({
    shouldBlockFn: async () => {
      if (!dirtyRef.current) return false;
      const leave = await confirm({
        title: 'Leave without saving?',
        body: 'Your changes to these settings will be lost.',
        confirmLabel: 'Discard changes',
      });
      return !leave;
    },
    enableBeforeUnload: () => dirtyRef.current,
  });

  // ⌘S / Ctrl+S saves while there are changes.
  useEffect(() => {
    if (!dirty) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        formRef.current?.requestSubmit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dirty]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const ok = await draft.submit();
    if (!ok)
      requestAnimationFrame(() => {
        const el = formRef.current?.querySelector<HTMLElement>('[aria-invalid=true]');
        el?.focus();
        el?.scrollIntoView({block: 'center', behavior: 'smooth'});
      });
  }

  const forbidden = error instanceof ApiError && (error.status === 403 || error.status === 401);
  const actions = !ro && (
    <>
      <span className="settings-save-state" aria-live="polite">
        {dirty ? (
          <>
            <span className="settings-dot" aria-hidden="true" />
            Unsaved changes
          </>
        ) : draft.savedAt ? (
          <>
            <Icon name="check" size={14} />
            Saved {timeOf(draft.savedAt)}
          </>
        ) : null}
      </span>
      <Button variant="secondary" size="sm" disabled={!dirty || saving} onClick={draft.discard}>
        Discard
      </Button>
      <Button size="sm" type="submit" disabled={!dirty} pending={saving} pendingLabel="Saving…">
        Save
      </Button>
    </>
  );

  return (
    <form ref={formRef} onSubmit={e => void onSubmit(e)} noValidate className="app-page settings-form">
      {embedded ? (
        <div className="settings-embedded-head">
          <p className="muted">{description}</p>
          {actions && <div className="settings-actions">{actions}</div>}
        </div>
      ) : (
        <PageHeader title={title} description={description} actions={actions ? <div className="settings-actions">{actions}</div> : undefined} />
      )}
      {ro && !error && <ReadOnlyNote />}
      {draft.formError && <Notice tone="danger">{draft.formError}</Notice>}

      {error ? (
        <Card>
          <EmptyState
            icon={forbidden ? 'lock' : 'alert'}
            title={forbidden ? 'You do not have access to store settings' : 'Settings could not be loaded'}
            action={
              !forbidden && (
                <Button variant="secondary" size="sm" icon="refresh" onClick={() => void draft.refetch()}>
                  Try again
                </Button>
              )
            }>
            {forbidden ? 'Ask an admin to add the settings area to your account.' : error.message}
          </EmptyState>
        </Card>
      ) : isLoading || !f ? (
        <div aria-busy="true">
          <LoadingBlock rows={3} />
        </div>
      ) : (
        <fieldset disabled={ro} className="settings-fieldset">
          {children(f)}
        </fieldset>
      )}

      {dirty && (
        <>
          <div aria-hidden="true" className="settings-savebar-spacer" />
          <div className="settings-savebar" role="region" aria-label="Unsaved settings">
            <span className="settings-savebar-count">
              {draft.changed} {draft.changed === 1 ? 'setting' : 'settings'} changed
              <span className="settings-savebar-hint"> · ⌘S to save</span>
            </span>
            <Button variant="ghost" size="sm" onClick={draft.discard} disabled={saving}>
              Discard
            </Button>
            <Button type="submit" size="sm" pending={saving} pendingLabel="Saving…">
              Save
            </Button>
          </div>
        </>
      )}
    </form>
  );
}

// ─── Layout pieces ────────────────────────────────────────────────────────────

/** One settings group: a card with its title and description, the fields inside. */
export function Section({id, title, description, children}: {id: string; title: string; description?: ReactNode; children: ReactNode}) {
  return (
    <div id={id} className="settings-group">
      <Card title={title} description={description}>
        <div className="settings-group-body">{children}</div>
      </Card>
    </div>
  );
}

/** A labelled on / off row, saved with the section's form (the save bar makes that explicit). */
export function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  /** Kept for VAREL call sites; the kit Switch labels itself. */
  id?: string;
  label: string;
  description?: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="settings-toggle">
      <Switch label={label} description={description} checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}

// ─── Validation helpers (client = server, SETTINGS_LIMITS in ./limits) ──────────

export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) && v.trim().length <= 254;
export const isWhole = (v: string, max = Infinity) =>
  v.trim() !== '' && Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= max;
export const isAmount = (v: string, max = Infinity) =>
  v.trim() !== '' && Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= max;
export const isUrl = (v: string) => {
  try {
    const u = new URL(v.trim());
    return (u.protocol === 'https:' || u.protocol === 'http:') && !/\s/.test(v.trim());
  } catch {
    return false;
  }
};
/** 0.25 → "25" */
export const toPercent = (rate: number) => String(Math.round(rate * 10000) / 100);
/** "25" → 0.25 */
export const fromPercent = (v: string) => Math.round(Number(v) * 100) / 10000;

/** The currency's symbol for a MoneyInput ("$", "kr.", "€"). */
export function currencySymbol(currency: string): string {
  try {
    return new Intl.NumberFormat('en', {style: 'currency', currency}).formatToParts(0).find(p => p.type === 'currency')?.value ?? currency;
  } catch {
    return currency;
  }
}
