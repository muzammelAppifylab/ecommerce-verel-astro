/* "Communication" (VAREL DetailsPage Preferences): the newsletter switch, optimistic while it saves. */
import { Switch, notify } from '@/components/varel'
import { errorMessage } from '@/lib/storefront-api'
import { useAccountT } from '../../i18n'
import { useUpdatePreferences } from '../../queries'
import { panelTitle } from '../../ui/recipes'

export function Preferences({ newsletter }: { newsletter: boolean }) {
  const t = useAccountT('account')
  const update = useUpdatePreferences()
  return (
    <section id="preferences" aria-labelledby="prefs-title" className="flex scroll-mt-28 flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h2 id="prefs-title" className={panelTitle}>
          {t('preferences.title')}
        </h2>
        <p className="m-0 text-[14.5px] text-text-secondary">{t('preferences.description')}</p>
      </div>
      <div className="flex max-w-[640px] items-start justify-between gap-6 border border-hairline p-5 md:p-6">
        <div className="flex flex-col gap-1">
          <label htmlFor="pref-newsletter" className="cursor-pointer text-[15px] text-text-primary">
            {t('preferences.newsletter')}
          </label>
          <span className="text-[14px] leading-body text-text-secondary">{t('preferences.newsletterBody')}</span>
          {update.isError && (
            <span role="alert" className="text-body-xs text-signal-critical">
              {errorMessage(update.error)}
            </span>
          )}
        </div>
        <Switch
          checked={update.isPending ? !!update.variables?.newsletter : newsletter}
          disabled={update.isPending}
          onChange={(on) =>
            update.mutate({ newsletter: on }, { onSuccess: () => notify(on ? t('preferences.on') : t('preferences.off')) })
          }
          className="mt-0.5"
          id="pref-newsletter"
        />
      </div>
    </section>
  )
}
