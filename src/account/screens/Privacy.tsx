/* /account/privacy/ — download a copy of your data, cookie choices, and close the account.
   Port of VAREL src/pages/account/PrivacyPage.tsx + PrivacySection.tsx. Deleting goes through
   `POST /site-api/account/delete`, which asks the template to delete the sign-in (password + "DELETE"), then
   hides the customer's details on their orders; on success the app reloads the home page signed out. */
import { useQuery } from '@tanstack/react-query'
import { useState, type FormEvent, type ReactNode } from 'react'
import { Dialog, Spinner, notify } from '@/components/varel'
import { openConsentSettings } from '@/lib/stores/consent'
import { errorMessage, isApiError } from '@/lib/storefront-api'
import { AccountHeader } from '../AccountShell'
import { useAccountContext, useAccountT } from '../i18n'
import { securityQuery, useDeleteMyAccount, useExportMyData } from '../queries'
import { deleteProblems, firstProblem } from '../rules'
import { PasswordField } from '../ui/PasswordField'
import { ProfileField } from '../ui/ProfileField'
import { outlineAction, solidAction, underlineAction } from '../ui/recipes'
import { focusField, hasFieldError, useFormErrors } from '../useFormErrors'
import { useTitle } from '../useTitle'

export function Privacy() {
  const t = useAccountT('account')
  useTitle(t('privacy.title'))
  const exporter = useExportMyData()
  const [open, setOpen] = useState(false)

  return (
    <section id="privacy" aria-label={t('privacy.title')} className="flex flex-col">
      <AccountHeader title={t('privacy.title')} description={t('privacy.description')} />
      <div className="flex flex-col">
        <Row
          title={t('privacy.data.title')}
          body={t('privacy.data.body')}
          action={
            <button
              type="button"
              onClick={() => exporter.mutate(undefined, { onSuccess: () => notify(t('privacy.data.downloading')) })}
              disabled={exporter.isPending}
              aria-busy={exporter.isPending ? true : undefined}
              className={outlineAction('px-[18px] py-[11px]')}
            >
              {exporter.isPending && <Spinner size={14} />}
              {exporter.isPending ? t('privacy.data.preparing') : t('privacy.data.action')}
            </button>
          }
          error={exporter.isError ? errorMessage(exporter.error) : null}
        />
        <Row
          title={t('privacy.cookies.title')}
          body={t('privacy.cookies.body')}
          action={
            <button type="button" onClick={openConsentSettings} className={underlineAction('cursor-pointer pb-1')}>
              {t('privacy.cookies.action')}
            </button>
          }
        />
        <Row
          title={t('privacy.delete.title')}
          body={t('privacy.delete.body')}
          action={
            <button
              type="button"
              onClick={() => setOpen(true)}
              className={outlineAction('border-signal-critical px-[18px] py-[11px] text-signal-critical hover:bg-signal-critical')}
            >
              {t('privacy.delete.action')}
            </button>
          }
        />
      </div>
      <DeleteAccountDialog open={open} onClose={() => setOpen(false)} />
    </section>
  )
}

export default Privacy

function Row({ title, body, action, error }: { title: string; body: string; action: ReactNode; error?: string | null }) {
  return (
    <div className="grid grid-cols-1 items-center gap-4 border-b border-hairline py-7 first:pt-0 md:grid-cols-[minmax(0,1fr)_auto] md:gap-10">
      <div className="flex min-w-0 flex-col gap-1.5">
        <h2 className="m-0 font-sans text-[16px] font-normal text-text-primary">{title}</h2>
        <p className="m-0 max-w-[60ch] text-[14.5px] leading-body text-text-secondary">{body}</p>
        {error && (
          <p role="alert" className="m-0 text-body-xs text-signal-critical">
            {error}
          </p>
        )}
      </div>
      <div className="justify-self-start md:justify-self-end">{action}</div>
    </div>
  )
}

const FIELDS = ['password', 'confirm'] as const
const IDS = { password: 'delete-password', confirm: 'delete-confirm' } as const

function DeleteAccountDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useAccountT('account')
  const { locale } = useAccountContext()
  const security = useQuery({ ...securityQuery, enabled: open })
  const hasPassword = security.data?.hasPassword !== false
  const del = useDeleteMyAccount(locale)
  const [form, setForm] = useState({ password: '', confirm: '' })
  const problems = deleteProblems(form, hasPassword)
  const errors = useFormErrors<'password' | 'confirm'>(problems, (key) => t(key))

  const close = () => {
    if (del.isPending || del.isSuccess) return
    setForm({ password: '', confirm: '' })
    errors.reset()
    del.reset()
    onClose()
  }

  const set = (k: 'password' | 'confirm') => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value
    setForm((f) => ({ ...f, [k]: v }))
    errors.changed(k)
  }

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    if (del.isPending || del.isSuccess) return
    if (!errors.submit()) return focusField(IDS[firstProblem(FIELDS, problems)!])
    // The hook loads the home page on success; the toast is shown first.
    del.mutate(
      { password: hasPassword ? form.password : '', confirm: form.confirm.trim() },
      {
        onSuccess: () => notify(t('privacy.delete.deleted')),
        onError: (err) => {
          if (isApiError(err) && errors.setServer(err.fields, FIELDS)) {
            focusField(IDS[FIELDS.find((k) => err.fields?.[k])!])
          }
        },
      },
    )
  }

  const busy = del.isPending || del.isSuccess
  const generalError = del.isError && !hasFieldError(del.error, FIELDS) ? errorMessage(del.error) : null

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t('privacy.delete.title')}
      description={t('privacy.delete.description')}
      width={480}
      footer={
        <div className="flex flex-wrap justify-end gap-3">
          <button type="button" onClick={close} disabled={busy} className={outlineAction('px-6 py-[15px]')}>
            {t('privacy.delete.cancel')}
          </button>
          <button
            type="submit"
            form="delete-account-form"
            disabled={busy}
            aria-busy={busy ? true : undefined}
            className={solidAction('bg-signal-critical px-7 py-[15px] hover:bg-signal-critical hover:opacity-90')}
          >
            {busy && <Spinner size={14} />}
            {busy ? t('privacy.delete.deleting') : t('privacy.delete.confirm')}
          </button>
        </div>
      }
    >
      <form
        id="delete-account-form"
        onSubmit={submit}
        noValidate
        className="flex flex-col gap-6 text-[15px] leading-body text-text-secondary"
      >
        <p className="m-0">{t('privacy.delete.warning')}</p>
        {hasPassword && (
          <PasswordField
            id={IDS.password}
            label={t('privacy.delete.password')}
            name="password"
            autoComplete="current-password"
            value={form.password}
            onChange={set('password')}
            onBlur={errors.blur('password')}
            error={errors.error('password')}
          />
        )}
        <ProfileField
          id={IDS.confirm}
          label={t('privacy.delete.confirmLabel')}
          name="confirm"
          type="text"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={16}
          value={form.confirm}
          onChange={set('confirm')}
          onBlur={errors.blur('confirm')}
          error={errors.error('confirm')}
        />
        {generalError && (
          <div role="alert" className="border border-signal-critical px-4 py-3.5 text-body-xs text-signal-critical">
            {generalError}
          </div>
        )}
      </form>
    </Dialog>
  )
}
