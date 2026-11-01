/* Settings · Languages · Setup (port of VAREL src/pages/admin/settings/LanguagesSettings.tsx): the storefront
   languages, the default (source) language, the machine translation provider with the status of its secrets, and
   automatic translation on save. Saved through PATCH /site-api/manage/settings (WP-23), changed fields only.
   Provider secrets are owner secrets added in the platform dashboard; they never pass through the admin.
   Read-only without `manageStoreSettings`. */
import {useQuery} from '@tanstack/react-query';
import {useBlocker} from '@tanstack/react-router';
import {useEffect, useMemo, useState} from 'react';

import type {StoreSettingsInput, TranslationProvider} from '../../../../lib/types/admin/store';
import type {SettingsWithI18n} from '../../../../lib/types/admin/translations';
import {ApiError} from '../../../api';
import {languageSettingsQuery, useUpdateLanguageSettings} from '../../../queries/languages';
import {
  Button,
  Card,
  ErrorNote,
  Field,
  IconButton,
  LoadingBlock,
  Notice,
  RadioCards,
  Select,
  StatusBadge,
  Switch,
  useConfirm,
  useToast,
} from '../../../ui';
import {languageName, ROUTABLE_LOCALES, SHIPPED} from './labels';

interface LanguagesForm {
  locales: string[];
  defaultLocale: string;
  translationProvider: TranslationProvider;
  autoTranslate: boolean;
}
type Errors = Partial<Record<keyof LanguagesForm, string>>;

const DEFAULT_LOCALES = ['en', 'da', 'de', 'fr', 'es', 'sv'];

function toForm(s: SettingsWithI18n): LanguagesForm {
  return {
    locales: s.locales?.length ? s.locales : DEFAULT_LOCALES,
    defaultLocale: s.defaultLocale ?? 'en',
    translationProvider: s.translationProvider ?? 'workers-ai',
    autoTranslate: s.autoTranslate ?? true,
  };
}

function validate(f: LanguagesForm): Errors {
  const e: Errors = {};
  if (!f.locales.length) e.locales = 'Keep at least one language.';
  if (!f.locales.includes(f.defaultLocale)) e.defaultLocale = 'The default language must be enabled.';
  return e;
}

/** Only the fields that changed (VAREL sent the whole section). */
function changes(saved: LanguagesForm, f: LanguagesForm): StoreSettingsInput {
  const out: StoreSettingsInput = {};
  if (saved.locales.join() !== f.locales.join()) out.locales = f.locales;
  if (saved.defaultLocale !== f.defaultLocale) out.defaultLocale = f.defaultLocale;
  if (saved.translationProvider !== f.translationProvider) out.translationProvider = f.translationProvider;
  if (saved.autoTranslate !== f.autoTranslate) out.autoTranslate = f.autoTranslate;
  return out;
}

const PROVIDERS: {value: TranslationProvider; title: string; body: string}[] = [
  {value: 'workers-ai', title: 'Cloudflare Workers AI', body: 'The m2m100 translation model on Cloudflare.'},
  {value: 'deepl', title: 'DeepL', body: 'Higher quality for European languages. Needs a DeepL API key (free or pro).'},
  {value: 'none', title: 'Manual only', body: 'Nothing is translated automatically. Enter every translation by hand.'},
];

export function Setup({canEdit}: {canEdit: boolean}) {
  const settings = useQuery(languageSettingsQuery);
  if (settings.isPending) return <LoadingBlock rows={4} />;
  if (settings.isError)
    return (
      <Card title="Setup">
        <ErrorNote error={settings.error} title="The language settings could not be loaded" />
        <div className="lang-retry">
          <Button variant="secondary" onClick={() => void settings.refetch()}>
            Try again
          </Button>
        </div>
      </Card>
    );
  return <SetupForm data={settings.data} canEdit={canEdit} />;
}

function SetupForm({data, canEdit}: {data: SettingsWithI18n; canEdit: boolean}) {
  const saved = useMemo(() => toForm(data), [data]);
  const [f, setF] = useState(saved);
  const [errors, setErrors] = useState<Errors>({});
  const [code, setCode] = useState('');
  const update = useUpdateLanguageSettings();
  const toast = useToast();
  const confirm = useConfirm();
  const ro = !canEdit;
  const diff = changes(saved, f);
  const dirty = Object.keys(diff).length > 0;
  const secrets = data.secrets;

  // A fresh read (after a save) becomes the new starting point.
  useEffect(() => setF(saved), [saved]);

  useBlocker({
    shouldBlockFn: async () =>
      dirty && !update.isPending
        ? !(await confirm({title: 'Discard your changes?', body: 'The language settings you changed are not saved.', confirmLabel: 'Discard changes'}))
        : false,
    enableBeforeUnload: () => dirty,
  });

  const set = (patch: Partial<LanguagesForm>) => {
    const next = {...f, ...patch};
    setF(next);
    if (Object.keys(errors).length) setErrors(validate(next));
  };
  const add = (c: string) => {
    if (!c || f.locales.includes(c)) return;
    set({locales: [...f.locales, c]});
    setCode('');
  };
  const remove = (l: string) => set({locales: f.locales.filter(x => x !== l)});
  const available = ROUTABLE_LOCALES.filter(c => !f.locales.includes(c));
  const ready = f.translationProvider === 'workers-ai' ? secrets?.workersAi : f.translationProvider === 'deepl' ? secrets?.deepl : true;

  const save = () => {
    const e = validate(f);
    setErrors(e);
    if (Object.keys(e).length) {
      document.getElementById(e.locales ? 'lang-add' : 'lang-default')?.focus();
      return;
    }
    update.mutate(diff, {
      onSuccess: () => toast.success('Language settings saved'),
      onError: err => {
        if (err instanceof ApiError && Object.keys(err.fields).length) setErrors(err.fields as Errors);
        toast.danger(err.message || 'The language settings could not be saved');
      },
    });
  };

  return (
    <div className="lang-setup">
      <Card
        title="Storefront languages"
        description="Customers pick one with the language switcher. Turning a language off hides it; its translations are kept.">
        <ul className="lang-enabled" aria-label="Enabled languages">
          {f.locales.map(l => (
            <li key={l} className="lang-enabled-item">
              <span className="lang-enabled-name">
                <span>{languageName(l)}</span>
                <code className="lang-card-code">{l}</code>
                {l === f.defaultLocale && <StatusBadge tone="brand">Default</StatusBadge>}
                {!SHIPPED.has(l) && <StatusBadge tone="neutral">Interface machine-translated</StatusBadge>}
              </span>
              {!ro && l !== f.defaultLocale && <IconButton icon="x" size="sm" label={`Remove ${languageName(l)}`} onClick={() => remove(l)} />}
            </li>
          ))}
        </ul>
        {errors.locales && (
          <p className="field-error" role="alert">
            {errors.locales}
          </p>
        )}
        <div className="lang-setup-fields">
          {!ro && (
            <Field
              label="Add a language"
              id="lang-add"
              hint={available.length ? 'The languages the storefront can show at their own address.' : 'Every language the storefront can show is already on.'}>
              <Select
                id="lang-add"
                value={code}
                disabled={!available.length}
                options={[{value: '', label: 'Choose a language'}, ...available.map(c => ({value: c, label: `${languageName(c)} · ${c}`}))]}
                onChange={event => add(event.target.value)}
              />
            </Field>
          )}
          <Field
            label="Default language"
            id="lang-default"
            error={errors.defaultLocale}
            hint="Shown to visitors whose browser language is not enabled. Content is written in this language and translated from it.">
            <Select
              id="lang-default"
              value={f.defaultLocale}
              disabled={ro}
              aria-invalid={errors.defaultLocale ? true : undefined}
              aria-describedby={errors.defaultLocale ? 'lang-default-error' : 'lang-default-hint'}
              options={[
                ...(f.locales.includes(f.defaultLocale) ? [] : [{value: f.defaultLocale, label: languageName(f.defaultLocale)}]),
                ...f.locales.map(l => ({value: l, label: languageName(l)})),
              ]}
              onChange={event => set({defaultLocale: event.target.value})}
            />
          </Field>
        </div>
        {f.defaultLocale !== saved.defaultLocale && (
          <Notice tone="warning">
            Changing the default language does not translate your existing content. Product names, posts and pages stay in the language they were
            written in.
          </Notice>
        )}
      </Card>

      <Card
        title="Translation provider"
        description="Used for content (products, journal, pages, menus, emails) and for the interface of languages without a shipped catalog.">
        <RadioCards
          legend="Translation provider"
          name="translation-provider"
          columns={3}
          value={f.translationProvider}
          onChange={v => set({translationProvider: v})}
          options={PROVIDERS.map(p => {
            const has = p.value === 'workers-ai' ? secrets?.workersAi : p.value === 'deepl' ? secrets?.deepl : undefined;
            return {
              value: p.value,
              disabled: ro,
              title: p.title,
              description: (
                <>
                  {p.body}
                  {has !== undefined && (
                    <span className="lang-provider-badge">
                      <StatusBadge tone={has ? 'success' : 'neutral'}>{has ? 'Configured' : 'Not configured'}</StatusBadge>
                    </span>
                  )}
                </>
              ),
            };
          })}
        />
        {f.translationProvider === 'workers-ai' && (
          <Notice tone={ready ? 'info' : 'warning'} title={ready ? 'Workers AI · configured' : 'Workers AI · not configured yet. Content is not translated until it is.'}>
            Add two secrets in your dashboard: CF_ACCOUNT_ID (your Cloudflare account id) and CF_AI_TOKEN (an API token with Workers AI read access).
            Content is not translated until both are added.
          </Notice>
        )}
        {f.translationProvider === 'deepl' && (
          <Notice tone={ready ? 'info' : 'warning'} title={ready ? 'DeepL · configured' : 'DeepL · not configured yet. Content is not translated until it is.'}>
            Create an API key at deepl.com (Account → API keys) and add it as the secret DEEPL_API_KEY in your dashboard. Free keys end in :fx and use
            the free endpoint automatically.
          </Notice>
        )}
        <Switch
          label="Translate content automatically"
          description={
            f.translationProvider === 'none' ? 'Needs a provider.' : 'Content is translated into every language when it is saved. Your manual edits are never replaced.'
          }
          checked={f.autoTranslate && f.translationProvider !== 'none'}
          disabled={ro || f.translationProvider === 'none'}
          onChange={v => set({autoTranslate: v})}
        />
      </Card>

      {!ro && dirty && (
        <div className="lang-savebar" role="region" aria-label="Unsaved changes">
          <span>Unsaved changes</span>
          <div className="lang-savebar-actions">
            <Button
              variant="secondary"
              disabled={update.isPending}
              onClick={() => {
                setF(saved);
                setErrors({});
              }}>
              Discard
            </Button>
            <Button pending={update.isPending} pendingLabel="Saving…" onClick={save}>
              Save
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
