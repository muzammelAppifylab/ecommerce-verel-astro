/* "Profile": name and phone (VAREL ProfileForm). The email is read-only here: it changes through the template's
   confirmation link (EmailDialog). Shows "Saved" for 1.8 s after a successful save. */
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Spinner } from '@/components/varel'
import { errorMessage, isApiError } from '@/lib/storefront-api'
import type { AccountUser } from '@/lib/types/account'
import { useAccountT } from '../../i18n'
import { useUpdateProfile } from '../../queries'
import { firstProblem, profileProblems, type ProfileFieldName } from '../../rules'
import { ProfileField } from '../../ui/ProfileField'
import { panelTitle, solidAction, underlineAction } from '../../ui/recipes'
import { focusField, hasFieldError, useFormErrors } from '../../useFormErrors'
import { EmailDialog } from './EmailDialog'

const FIELDS = ['firstName', 'lastName', 'phone'] as const
const fieldId = (k: ProfileFieldName) => `profile-${k}`

export function ProfileForm({ user, hasPassword }: { user: AccountUser; hasPassword: boolean }) {
  const t = useAccountT('account')
  const [form, setForm] = useState({ firstName: user.firstName, lastName: user.lastName, phone: user.phone ?? '' })
  const [saved, setSaved] = useState(false)
  const [emailOpen, setEmailOpen] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const update = useUpdateProfile()
  const problems = profileProblems(form)
  const errors = useFormErrors<ProfileFieldName>(problems, (key) => t(key))

  // Follow the server copy when it changes underneath us (e.g. after save).
  useEffect(() => {
    setForm({ firstName: user.firstName, lastName: user.lastName, phone: user.phone ?? '' })
  }, [user.firstName, user.lastName, user.phone])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const set = (k: ProfileFieldName) => (e: ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value
    setForm((f) => ({ ...f, [k]: v }))
    errors.changed(k)
    setSaved(false)
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (update.isPending) return
    if (!errors.submit()) return focusField(fieldId(firstProblem(FIELDS, problems)!))
    update.mutate(
      { firstName: form.firstName.trim(), lastName: form.lastName.trim(), phone: form.phone.trim() || null },
      {
        onSuccess: () => {
          setSaved(true)
          window.clearTimeout(timer.current)
          timer.current = window.setTimeout(() => setSaved(false), 1800)
        },
        onError: (err) => {
          if (isApiError(err) && errors.setServer(err.fields, FIELDS)) {
            focusField(fieldId(FIELDS.find((k) => err.fields?.[k])!))
          }
        },
      },
    )
  }

  const generalError = update.isError && !hasFieldError(update.error, FIELDS) ? errorMessage(update.error) : null

  return (
    <section id="profile" aria-labelledby="profile-title" className="flex scroll-mt-28 flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h2 id="profile-title" className={panelTitle}>
          {t('profile.title')}
        </h2>
        <p className="m-0 text-[14.5px] text-text-secondary">{t('profile.description')}</p>
      </div>
      <form onSubmit={onSubmit} noValidate className="grid max-w-[640px] grid-cols-1 gap-7 sm:grid-cols-2">
        <ProfileField
          id={fieldId('firstName')}
          label={t('profile.firstName')}
          name="firstName"
          type="text"
          autoComplete="given-name"
          maxLength={120}
          value={form.firstName}
          onChange={set('firstName')}
          onBlur={errors.blur('firstName')}
          error={errors.error('firstName')}
        />
        <ProfileField
          id={fieldId('lastName')}
          label={t('profile.lastName')}
          name="lastName"
          type="text"
          autoComplete="family-name"
          maxLength={120}
          value={form.lastName}
          onChange={set('lastName')}
          onBlur={errors.blur('lastName')}
          error={errors.error('lastName')}
        />
        <div className="flex flex-col gap-2 sm:col-span-2">
          <span className="text-[13.5px] text-text-secondary">{t('profile.email')}</span>
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-hairline py-2.5">
            <span className="min-w-0 truncate text-[15px] font-light text-text-primary">{user.email}</span>
            <button type="button" onClick={() => setEmailOpen(true)} className={underlineAction('pb-0.5')}>
              {t('profile.changeEmail')}
            </button>
          </div>
          <span className="text-body-xs text-text-secondary">{t('profile.emailHint')}</span>
        </div>
        <ProfileField
          id={fieldId('phone')}
          label={t('profile.phone')}
          name="phone"
          type="tel"
          autoComplete="tel"
          maxLength={60}
          value={form.phone}
          onChange={set('phone')}
          onBlur={errors.blur('phone')}
          error={errors.error('phone')}
          className="sm:col-span-2"
        />
        {generalError && (
          <div role="alert" className="border border-signal-critical px-4 py-3.5 text-body-xs text-signal-critical sm:col-span-2">
            {generalError}
          </div>
        )}
        <button
          type="submit"
          disabled={update.isPending}
          aria-busy={update.isPending ? true : undefined}
          className={solidAction('justify-self-start px-7 py-[15px] sm:col-span-2')}
          aria-live="polite"
        >
          {update.isPending && <Spinner size={14} />}
          {update.isPending ? t('profile.saving') : saved ? t('profile.saved') : t('profile.save')}
        </button>
      </form>
      <EmailDialog open={emailOpen} current={user.email} hasPassword={hasPassword} onClose={() => setEmailOpen(false)} />
    </section>
  )
}
