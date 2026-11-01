/* /account/addresses/ — saved delivery addresses: add, edit, remove, make default.
   Port of VAREL src/pages/account/AddressesPage.tsx + AddressesSection.tsx. The acted-on card shows the pending
   state; its other buttons are disabled meanwhile (`busyId`). */
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Button, EmptyState, Skeleton } from '@/components/varel'
import { errorMessage } from '@/lib/storefront-api'
import type { Address } from '@/lib/types/account'
import { cn } from '@/lib/utils'
import { AccountHeader } from '../AccountShell'
import { useAccountContext, useAccountT } from '../i18n'
import { addressesQuery, useDeleteAddress, useUpdateAddress } from '../queries'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { addressBlock, addressLines } from '../ui/orderUtils'
import { outlineAction } from '../ui/recipes'
import { useTitle } from '../useTitle'
import { AddressDialog } from './addresses/AddressDialog'

type Pending =
  | { kind: 'edit'; address: Address | null }
  | { kind: 'remove'; address: Address }
  | { kind: 'primary'; address: Address }
  | null

export function Addresses() {
  const t = useAccountT('account')
  useTitle(t('nav.addresses'))
  const q = useQuery(addressesQuery)
  if (q.isLoading) {
    return (
      <div className="flex flex-col gap-8" aria-busy="true">
        <Skeleton className="h-11 w-60" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Skeleton className="h-52" />
          <Skeleton className="h-52" />
        </div>
      </div>
    )
  }
  if (q.isError || !q.data) {
    return (
      <EmptyState
        title={t('loadError')}
        description={errorMessage(q.error)}
        action={
          <Button variant="outline" onClick={() => q.refetch()}>
            {t('tryAgain')}
          </Button>
        }
      />
    )
  }
  return <AddressesSection addresses={q.data} />
}

export default Addresses

export function AddressesSection({ addresses }: { addresses: Address[] }) {
  const t = useAccountT('account')
  const { locale } = useAccountContext()
  const [pending, setPending] = useState<Pending>(null)
  const remove = useDeleteAddress()
  const update = useUpdateAddress()

  // The card being acted on (remove / make default in flight).
  const busyId =
    (remove.isPending && pending?.kind === 'remove' && pending.address.id) ||
    (update.isPending && pending?.kind === 'primary' && pending.address.id) ||
    null

  const close = () => {
    if (remove.isPending || update.isPending) return
    setPending(null)
    remove.reset()
    update.reset()
  }

  const labelOf = (a: Address) => a.label || t('addresses.addressLower')
  const action = 'cursor-pointer border-0 bg-transparent p-0 text-[14px] transition-hover disabled:cursor-not-allowed disabled:opacity-50'
  const add = () => setPending({ kind: 'edit', address: null })

  return (
    <section id="addresses" aria-label={t('nav.addresses')} className="flex flex-col">
      <AccountHeader
        title={t('nav.addresses')}
        description={t('addresses.description')}
        actions={
          <button type="button" onClick={add} className={outlineAction('px-5 py-3')}>
            {t('addresses.add')}
          </button>
        }
      />

      {addresses.length === 0 ? (
        <div className="flex flex-col items-start gap-4 bg-chalk p-7 md:p-9">
          <p className="m-0 max-w-[52ch] text-[15px] leading-body text-text-secondary">{t('addresses.empty')}</p>
          <button type="button" onClick={add} className={outlineAction('px-5 py-3')}>
            {t('addresses.add')}
          </button>
        </div>
      ) : (
        <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 md:grid-cols-2">
          {addresses.map((a) => {
            const busy = busyId === a.id
            return (
              <li
                key={a.id}
                aria-busy={busy ? true : undefined}
                className={cn('flex flex-col gap-4 border p-6 md:p-7', a.primary ? 'border-ink-900' : 'border-hairline')}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[15px] text-text-primary">{a.label || t('addresses.address')}</span>
                  {a.primary && (
                    <span className="bg-ink-900 px-2 py-1 font-sans text-[10.5px] leading-none font-normal tracking-label text-text-inverse uppercase">
                      {t('addresses.default')}
                    </span>
                  )}
                </div>
                <address className="flex flex-col text-[15px] leading-body text-text-secondary not-italic">
                  {addressLines(a, locale).map((line, i) => (
                    <span key={`${i}-${line}`}>{line}</span>
                  ))}
                  {a.phone && <span className="mt-1">{a.phone}</span>}
                </address>
                <div className="mt-auto flex flex-wrap gap-x-5 gap-y-2 border-t border-hairline pt-4">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setPending({ kind: 'edit', address: a })}
                    className={cn(action, 'text-text-primary underline underline-offset-4 hover:text-ink-500')}
                    aria-label={t('addresses.editAria', { label: labelOf(a) })}
                  >
                    {t('addresses.edit')}
                  </button>
                  {!a.primary && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setPending({ kind: 'primary', address: a })}
                      className={cn(action, 'text-text-secondary hover:text-text-primary')}
                      aria-label={t('addresses.makeDefaultAria', { label: labelOf(a) })}
                    >
                      {t('addresses.makeDefault')}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setPending({ kind: 'remove', address: a })}
                    className={cn(action, 'ml-auto text-signal-critical hover:opacity-62')}
                    aria-label={t('addresses.removeAria', { label: labelOf(a) })}
                  >
                    {t('addresses.remove')}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <AddressDialog
        open={pending?.kind === 'edit'}
        address={pending?.kind === 'edit' ? pending.address : null}
        first={addresses.length === 0}
        onClose={() => setPending(null)}
      />

      <ConfirmDialog
        open={pending?.kind === 'remove'}
        title={t('addresses.removeTitle')}
        confirmLabel={t('addresses.remove')}
        pendingLabel={t('addresses.removing')}
        destructive
        pending={remove.isPending}
        error={remove.isError ? errorMessage(remove.error) : null}
        onClose={close}
        onConfirm={() =>
          pending?.kind === 'remove' &&
          remove.mutate(pending.address.id, {
            onSuccess: () => {
              setPending(null)
              remove.reset()
            },
          })
        }
      >
        {pending?.kind === 'remove' && <p className="m-0">{addressBlock(pending.address, locale)}</p>}
      </ConfirmDialog>

      <ConfirmDialog
        open={pending?.kind === 'primary'}
        title={t('addresses.makeDefault')}
        confirmLabel={t('addresses.makeDefault')}
        pendingLabel={t('addresses.saving')}
        pending={update.isPending}
        error={update.isError ? errorMessage(update.error) : null}
        onClose={close}
        onConfirm={() =>
          pending?.kind === 'primary' &&
          update.mutate(
            { id: pending.address.id, primary: true },
            {
              onSuccess: () => {
                setPending(null)
                update.reset()
              },
            },
          )
        }
      >
        {pending?.kind === 'primary' && (
          <p className="m-0">{t('addresses.makeDefaultBody', { address: addressBlock(pending.address, locale) })}</p>
        )}
      </ConfirmDialog>
    </section>
  )
}
