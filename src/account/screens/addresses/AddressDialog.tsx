/* Add / edit a saved address (VAREL src/pages/account/AddressDialog.tsx). Client rules mirror the server's
   (src/server/routes/account.ts `addressFields`); server field errors land on their fields. */
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent } from 'react'
import { Checkbox, Dialog, Input, Select, Spinner } from '@/components/varel'
import { errorMessage, isApiError } from '@/lib/storefront-api'
import type { Address, AddressInput } from '@/lib/types/account'
import { useAccountContext, useAccountT } from '../../i18n'
import { countriesQuery, useCreateAddress, useUpdateAddress } from '../../queries'
import { addressMax, addressProblems, firstProblem, type AddressFieldName } from '../../rules'
import { countryOptions } from '../../ui/countries'
import { outlineAction, solidAction } from '../../ui/recipes'
import { focusField, hasFieldError, useFormErrors } from '../../useFormErrors'

interface Props {
  open: boolean
  /** Address to edit; null/undefined adds a new one */
  address?: Address | null
  /** True when the customer has no addresses yet (the first one becomes the default) */
  first?: boolean
  onClose: () => void
}

type Form = Record<AddressFieldName, string> & { primary: boolean }

const DEFAULT_COUNTRY = 'Denmark'
const FIELDS = ['label', 'name', 'line1', 'line2', 'zip', 'city', 'country', 'phone'] as const
const fieldId = (k: AddressFieldName) => `address-${k}`

function toForm(a: Address | null | undefined, first: boolean | undefined, country: string): Form {
  if (!a) return { label: '', name: '', line1: '', line2: '', zip: '', city: '', country, phone: '', primary: !!first }
  return {
    label: a.label ?? '',
    name: a.name,
    line1: a.line1,
    line2: a.line2 ?? '',
    zip: a.zip,
    city: a.city,
    country: a.country,
    phone: a.phone ?? '',
    primary: a.primary,
  }
}

export function AddressDialog({ open, address, first, onClose }: Props) {
  const t = useAccountT('account')
  const { locale } = useAccountContext()
  const editing = !!address
  const countries = useQuery({ ...countriesQuery, enabled: open })
  const list = countries.data ?? []
  const defaultCountry = list.includes(DEFAULT_COUNTRY) ? DEFAULT_COUNTRY : (list[0] ?? DEFAULT_COUNTRY)
  const [form, setForm] = useState<Form>(() => toForm(address, first, defaultCountry))
  const create = useCreateAddress()
  const update = useUpdateAddress()
  const mutation = editing ? update : create
  const problems = addressProblems(form)
  const errors = useFormErrors<AddressFieldName>(problems, (key, field) => t(key, { max: addressMax(field) }))
  const { reset: resetErrors } = errors

  // Reset whenever the dialog opens for a different address.
  useEffect(() => {
    if (open) {
      setForm(toForm(address, first, defaultCountry))
      resetErrors()
      create.reset()
      update.reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, address?.id])

  // A new address follows the store's list once it arrives (Denmark when it ships there, else its first country).
  useEffect(() => {
    if (open && !editing && list.length && !list.includes(form.country)) setForm((f) => ({ ...f, country: defaultCountry }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing, list.length])

  const close = () => {
    if (!mutation.isPending) onClose()
  }

  const set = (k: AddressFieldName) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const v = e.target.value
    setForm((f) => ({ ...f, [k]: v }))
    errors.changed(k)
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (mutation.isPending) return
    if (!errors.submit()) return focusField(fieldId(firstProblem(FIELDS, problems)!))

    const input: AddressInput = {
      label: form.label.trim() || null,
      name: form.name.trim(),
      line1: form.line1.trim(),
      line2: form.line2.trim() || null,
      zip: form.zip.trim(),
      city: form.city.trim(),
      country: form.country,
      phone: form.phone.trim() || null,
      primary: form.primary,
    }
    const opts = {
      onSuccess: () => onClose(),
      onError: (err: unknown) => {
        if (isApiError(err) && errors.setServer(err.fields, FIELDS)) {
          focusField(fieldId(FIELDS.find((k) => err.fields?.[k])!))
        }
      },
    }
    if (editing && address) update.mutate({ id: address.id, ...input }, opts)
    else create.mutate(input, opts)
  }

  const countryList = list.length ? list : [form.country].filter(Boolean)
  const formId = 'address-form'
  const field = (k: AddressFieldName) => ({
    id: fieldId(k),
    name: k,
    value: form[k],
    onChange: set(k),
    onBlur: errors.blur(k),
    error: errors.error(k),
    maxLength: addressMax(k) + 20,
  })

  return (
    <Dialog
      open={open}
      onClose={close}
      title={editing ? t('dialog.edit') : t('dialog.add')}
      width={600}
      footer={
        <div className="flex flex-wrap justify-end gap-3">
          <button type="button" onClick={close} disabled={mutation.isPending} className={outlineAction('px-6 py-[15px]')}>
            {t('dialog.cancel')}
          </button>
          <button
            type="submit"
            form={formId}
            disabled={mutation.isPending}
            aria-busy={mutation.isPending ? true : undefined}
            className={solidAction('px-7 py-[15px]')}
          >
            {mutation.isPending && <Spinner size={14} />}
            {mutation.isPending ? t('dialog.saving') : t('dialog.save')}
          </button>
        </div>
      }
    >
      <form id={formId} onSubmit={onSubmit} noValidate className="grid grid-cols-1 gap-x-6 gap-y-6 sm:grid-cols-2">
        <Input label={t('dialog.label')} placeholder={t('dialog.labelPlaceholder')} {...field('label')} className="sm:col-span-2" />
        <Input label={t('dialog.fullName')} autoComplete="name" {...field('name')} className="sm:col-span-2" />
        <Input label={t('dialog.line1')} autoComplete="address-line1" {...field('line1')} className="sm:col-span-2" />
        <Input label={t('dialog.line2')} autoComplete="address-line2" {...field('line2')} className="sm:col-span-2" />
        <Input label={t('dialog.zip')} autoComplete="postal-code" {...field('zip')} />
        <Input label={t('dialog.city')} autoComplete="address-level2" {...field('city')} />
        <Select
          id={fieldId('country')}
          name="country"
          label={t('dialog.country')}
          value={form.country}
          onChange={set('country')}
          options={countryOptions(countryList, locale)}
          autoComplete="country-name"
          error={errors.error('country')}
        />
        <Input label={t('dialog.phone')} type="tel" autoComplete="tel" {...field('phone')} />
        <Checkbox
          className="sm:col-span-2"
          checked={form.primary}
          disabled={editing && address?.primary}
          onCheckedChange={(on) => setForm((f) => ({ ...f, primary: on }))}
          label={t('dialog.primary')}
        />
        {mutation.isError && !hasFieldError(mutation.error, FIELDS) && (
          <div role="alert" className="border border-signal-critical px-4 py-3.5 text-body-xs text-signal-critical sm:col-span-2">
            {errorMessage(mutation.error)}
          </div>
        )}
      </form>
    </Dialog>
  )
}
