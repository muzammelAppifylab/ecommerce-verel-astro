/* Settings · Languages (`/dashboard/settings/languages`): the one place for translations (port of VAREL
   src/pages/admin/translations/Languages.tsx; docs/I18N.md). Pick a language from the rail, find any text and edit
   its translation in place. Languages are added or removed from the rail; the default language, provider and
   automatic translation live under "Setup". Manual edits are kept; "Translate missing" backfills the rest.
   Reads and writes need `manageContent`; changing the languages needs `manageStoreSettings`. */
import {useQuery} from '@tanstack/react-query';
import {getRouteApi, useNavigate} from '@tanstack/react-router';
import {useCallback, useEffect, useState} from 'react';

import {ApiError, hasAbility} from '../../../api';
import {translationsStatusQuery, useTranslateAllMissing, type TranslationsSearch} from '../../../queries/languages';
import {useMe} from '../../../shared';
import {Button, EmptyState, PageHeader, Tabs} from '../../../ui';
import {AddLanguageModal} from './AddLanguageModal';
import {BackfillProgress} from './BackfillProgress';
import {languageName} from './labels';
import {LanguageRail} from './LanguageRail';
import {Setup} from './Setup';
import {Workspace} from './Workspace';

const route = getRouteApi('/settings/languages');

type View = 'translations' | 'setup';

/** `/dashboard/settings/languages`. */
export function Languages() {
  const search = route.useSearch();
  const navigate = useNavigate({from: '/settings/languages'});
  const set = useCallback(
    (patch: Partial<TranslationsSearch>) => void navigate({search: prev => ({...prev, ...patch}), replace: true, resetScroll: false}),
    [navigate]
  );
  const abilities = useMe().data?.abilities;
  const canWrite = hasAbility(abilities, 'manageContent');
  const canEditLanguages = hasAbility(abilities, 'manageStoreSettings');
  const backfill = useTranslateAllMissing();
  const status = useQuery(translationsStatusQuery(backfill.progress.running));
  const s = status.data;
  const targets = s ? s.locales.filter(l => l !== s.defaultLocale) : [];
  const locale = search.locale && targets.includes(search.locale) ? search.locale : targets[0];
  const forbidden = status.error instanceof ApiError && (status.error.status === 403 || status.error.status === 401);
  const [adding, setAdding] = useState(false);

  const translate = (l?: string) => void backfill.run(l ? {locale: l} : {}).then(() => void status.refetch());
  // Setup may have added, removed or re-ordered languages: refresh coverage on the way back.
  const {refetch} = status;
  useEffect(() => {
    if (!search.view) void refetch();
  }, [search.view, refetch]);

  // `locales` lists the target languages; the default language is shown too.
  const shown = s ? targets.length + 1 : 0;
  return (
    <>
      <PageHeader
        title="Languages"
        description={
          s
            ? `Written in ${languageName(s.defaultLocale)}, shown in ${shown} ${shown === 1 ? 'language' : 'languages'}. ${
                s.provider === 'none'
                  ? 'Translations are entered by hand.'
                  : s.autoTranslate
                    ? 'New content is translated when you save it; your edits are kept.'
                    : 'Content is translated when you ask; your edits are kept.'
              }`
            : 'The languages customers can shop in, and every translation.'
        }
      />

      <Tabs<View>
        label="Languages"
        value={search.view === 'setup' ? 'setup' : 'translations'}
        onChange={v => set({view: v === 'setup' ? 'setup' : undefined})}
        items={[
          {value: 'translations', label: 'Translations'},
          {value: 'setup', label: 'Setup'},
        ]}>
        {search.view === 'setup' ? (
          <Setup canEdit={canEditLanguages} />
        ) : status.error ? (
          <EmptyState
            icon={forbidden ? 'lock' : 'alert'}
            title={forbidden ? 'You do not have access to translations' : 'Translations could not be loaded'}
            action={
              forbidden ? undefined : (
                <Button variant="secondary" onClick={() => void status.refetch()}>
                  Try again
                </Button>
              )
            }>
            {forbidden ? 'Ask an admin to add the content area to your account.' : status.error.message}
          </EmptyState>
        ) : (
          <div className="lang-screen">
            <LanguageRail
              status={s}
              loading={status.isPending}
              selected={locale}
              canAdd={canEditLanguages}
              onSelect={l => set({locale: l})}
              onAdd={() => setAdding(true)}
            />
            <BackfillProgress progress={backfill.progress} onCancel={backfill.cancel} />
            {s && locale ? (
              <Workspace
                key={locale}
                status={s}
                locale={locale}
                search={search}
                set={set}
                busy={backfill.progress.running}
                canWrite={canWrite}
                canEditLanguages={canEditLanguages}
                onTranslateMissing={() => translate(locale)}
                onRemoved={() => set({locale: undefined})}
              />
            ) : s && !targets.length ? (
              <EmptyState
                icon="languages"
                title={`The store is in ${languageName(s.defaultLocale)} only`}
                action={
                  canEditLanguages ? (
                    <Button icon="plus" onClick={() => setAdding(true)}>
                      Add a language
                    </Button>
                  ) : undefined
                }>
                Add a language to start translating products, pages and emails.
              </EmptyState>
            ) : null}
          </div>
        )}
      </Tabs>

      {s && canEditLanguages && (
        <AddLanguageModal
          open={adding}
          onClose={() => setAdding(false)}
          status={s}
          onAdded={(code, now) => {
            setAdding(false);
            void status.refetch();
            set({locale: code, view: undefined});
            if (now) translate(code);
          }}
        />
      )}
    </>
  );
}
