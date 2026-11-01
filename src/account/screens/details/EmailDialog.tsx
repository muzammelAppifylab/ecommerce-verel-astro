/* Change email (new; VAREL edited the email in the profile form). The template's `POST /site-api/auth/email`
   mails a confirmation link to the new address and answers 202 whether or not that address is taken (no
   enumeration); the email changes only once the link is opened. */
import { useEffect, useState, type FormEvent } from 'react'
import { Dialog, Spinner, notify } from '@/components/varel'
import { errorMessage, isApiError } from '@/lib/storefront-api'
import { useAccountT } from '../../i18n'
import { useChangeEmail } from '../../queries'
import { emailProblems, firstProblem, type EmailFieldName } from '../../rules'
import { PasswordField } from '../../ui/PasswordField'
import { ProfileField } from '../../ui/ProfileField'
import { outlineAction, solidAction } from '../../ui/recipes'
import { focusField, hasFieldError, useFormErrors } from '../../useFormErrors'

const FIELDS = ['email', 'password'] as const
const fieldId = (k: EmailFieldName) => `change-email-${k}`

export function EmailDialog({
  open,
  current,
  hasPassword,
  onClose,
}: {
  open: boolean
  current: string
  hasPassword: boolean
  onClose: () => void
}) {
  const t = useAccountT('account')
  const change = useChangeEmail()
  const [form, setForm] = useState({ email: '', password: '' })
  const problems = emailProblems(form, current, hasPassword)
  const errors = useFormErrors<EmailFieldName>(problems, (key) => t(key))
  const { reset: resetErrors } = errors
  const { reset: resetMutation } = change

  useEffect(() => {
    if (open) {
      setForm({ email: '', password: '' })
      resetErrors()
      resetMutation()
    }
  }, [open, resetErrors, resetMutation])

  const close = () => {
    if (!change.isPending) onClose()
  }

  const set = (k: EmailFieldName) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value
    setForm((f) => ({ ...f, [k]: v }))
    errors.changed(k)
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (change.isPending) return
    if (!errors.submit()) return focusField(fieldId(firstProblem(FIELDS, problems)!))
    change.mutate(
      { email: form.email.trim(), password: hasPassword ? form.password : '' },
      {
        onSuccess: (res) => {
          onClose()
          notify(res?.message || t('email.title'))
        },
        onError: (err) => {
          if (isApiError(err) && errors.setServer(err.fields, FIELDS)) {
            focusField(fieldId(FIELDS.find((k) => err.fields?.[k])!))
          }
        },
      },
    )
  }

  const generalError = change.isError && !hasFieldError(change.error, FIELDS) ? errorMessage(change.error) : null

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t('email.title')}
      description={t('profile.emailHint')}
      width={480}
      footer={
        <div className="flex flex-wrap justify-end gap-3">
          <button type="button" onClick={close} disabled={change.isPending} className={outlineAction('px-6 py-[15px]')}>
            {t('confirm.cancel')}
          </button>
          <button
            type="submit"
            form="change-email-form"
            disabled={change.isPending}
            aria-busy={change.isPending ? true : undefined}
            className={solidAction('px-7 py-[15px]')}
          >
            {change.isPending && <Spinner size={14} />}
            {change.isPending ? t('email.sending') : t('email.send')}
          </button>
        </div>
      }
    >
      <form id="change-email-form" onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
        <ProfileField
          id={fieldId('email')}
          label={t('email.new')}
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          maxLength={254}
          value={form.email}
          onChange={set('email')}
          onBlur={errors.blur('email')}
          error={errors.error('email')}
        />
        {hasPassword && (
          <PasswordField
            id={fieldId('password')}
            label={t('email.password')}
            name="password"
            autoComplete="current-password"
            value={form.password}
            onChange={set('password')}
            onBlur={errors.blur('password')}
            error={errors.error('password')}
          />
        )}
        {generalError && (
          <div role="alert" className="border border-signal-critical px-4 py-3.5 text-body-xs text-signal-critical">
            {generalError}
          </div>
        )}
      </form>
    </Dialog>
  )
}
