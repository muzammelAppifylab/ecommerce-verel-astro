/* "Password" (VAREL DetailsPage PasswordForm). Changed through the template (`POST /site-api/auth/change-password`,
   10–128 characters, signs other devices out). Every field has its own show / hide button. Accounts made with an
   emailed code have no password: they get a link to set one instead of the form. */
import { useState, type ChangeEvent, type FormEvent } from 'react'
import { Spinner, notify } from '@/components/varel'
import { errorMessage, isApiError } from '@/lib/storefront-api'
import { useAccountT } from '../../i18n'
import { useChangePassword } from '../../queries'
import { firstProblem, passwordProblems, type PasswordFieldName } from '../../rules'
import { PasswordField } from '../../ui/PasswordField'
import { accountLinks } from '../../ui/orderUtils'
import { panelTitle, solidAction, underlineAction } from '../../ui/recipes'
import { focusField, hasFieldError, useFormErrors } from '../../useFormErrors'

const FIELDS = ['currentPassword', 'newPassword', 'confirm'] as const
const IDS: Record<PasswordFieldName, string> = { currentPassword: 'pw-current', newPassword: 'pw-new', confirm: 'pw-confirm' }
const EMPTY = { currentPassword: '', newPassword: '', confirm: '' }

export function PasswordForm({ email, hasPassword, locale }: { email: string; hasPassword: boolean; locale: string }) {
  const t = useAccountT('account')
  const links = accountLinks(locale)

  return (
    <section id="password" aria-labelledby="password-title" className="flex scroll-mt-28 flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h2 id="password-title" className={panelTitle}>
          {t('password.title')}
        </h2>
        <p className="m-0 text-[14.5px] text-text-secondary">{t('password.description')}</p>
      </div>
      {hasPassword ? (
        <ChangePassword email={email} forgotHref={links.forgot} />
      ) : (
        <div className="flex max-w-[640px] flex-col items-start gap-4 bg-chalk p-6">
          <p className="m-0 text-[14.5px] leading-body text-text-secondary">{t('password.noPassword')}</p>
          <a href={links.forgot} className={underlineAction('pb-1')}>
            {t('password.setLink')}
          </a>
        </div>
      )}
    </section>
  )
}

function ChangePassword({ email, forgotHref }: { email: string; forgotHref: string }) {
  const t = useAccountT('account')
  const change = useChangePassword()
  const [form, setForm] = useState(EMPTY)
  const problems = passwordProblems(form, email)
  const errors = useFormErrors<PasswordFieldName>(problems, (key) => t(key))

  const set = (k: PasswordFieldName) => (e: ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value
    setForm((f) => ({ ...f, [k]: v }))
    errors.changed(k)
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (change.isPending) return
    if (!errors.submit()) return focusField(IDS[firstProblem(FIELDS, problems)!])
    change.mutate(
      { currentPassword: form.currentPassword, newPassword: form.newPassword },
      {
        onSuccess: () => {
          setForm(EMPTY)
          errors.reset()
          notify(t('password.changed'))
        },
        onError: (err) => {
          if (isApiError(err) && errors.setServer(err.fields, FIELDS)) {
            focusField(IDS[FIELDS.find((k) => err.fields?.[k])!])
          }
        },
      },
    )
  }

  const generalError = change.isError && !hasFieldError(change.error, FIELDS) ? errorMessage(change.error) : null

  return (
    <form onSubmit={onSubmit} noValidate className="grid max-w-[640px] grid-cols-1 gap-7 sm:grid-cols-2">
      <PasswordField
        id={IDS.currentPassword}
        label={t('password.current')}
        name="currentPassword"
        autoComplete="current-password"
        value={form.currentPassword}
        onChange={set('currentPassword')}
        onBlur={errors.blur('currentPassword')}
        error={errors.error('currentPassword')}
        className="sm:col-span-2"
      />
      <PasswordField
        id={IDS.newPassword}
        label={t('password.new')}
        name="newPassword"
        autoComplete="new-password"
        value={form.newPassword}
        onChange={set('newPassword')}
        onBlur={errors.blur('newPassword')}
        error={errors.error('newPassword')}
      />
      <PasswordField
        id={IDS.confirm}
        label={t('password.confirm')}
        name="confirm"
        autoComplete="new-password"
        value={form.confirm}
        onChange={set('confirm')}
        onBlur={errors.blur('confirm')}
        error={errors.error('confirm')}
      />
      <p className="m-0 -mt-3 text-[13px] text-text-secondary sm:col-span-2">{t('password.rule')}</p>
      {generalError && (
        <div role="alert" className="border border-signal-critical px-4 py-3.5 text-body-xs text-signal-critical sm:col-span-2">
          {generalError}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 sm:col-span-2">
        <button
          type="submit"
          disabled={change.isPending}
          aria-busy={change.isPending ? true : undefined}
          className={solidAction('px-7 py-[15px]')}
        >
          {change.isPending && <Spinner size={14} />}
          {change.isPending ? t('password.saving') : t('password.save')}
        </button>
        <a href={forgotHref} className="text-[14px]">
          {t('password.forgot')}
        </a>
      </div>
    </form>
  )
}
