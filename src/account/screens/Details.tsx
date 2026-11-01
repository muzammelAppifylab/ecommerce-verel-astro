/* /account/details/ — name and contact, password, and what we may send (VAREL DetailsPage). The customer comes
   from the overview (no separate /me read); whether the account has a password from the template. */
import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useLocation } from '@tanstack/react-router'
import { Button, EmptyState, Skeleton } from '@/components/varel'
import { errorMessage } from '@/lib/storefront-api'
import { AccountHeader } from '../AccountShell'
import { useAccountContext, useAccountT } from '../i18n'
import { overviewQuery, securityQuery } from '../queries'
import { useTitle } from '../useTitle'
import { PasswordForm } from './details/PasswordForm'
import { Preferences } from './details/Preferences'
import { ProfileForm } from './details/ProfileForm'

export function Details() {
  const t = useAccountT('account')
  const { locale } = useAccountContext()
  useTitle(t('nav.details'))
  const overview = useQuery(overviewQuery)
  const security = useQuery(securityQuery)
  useScrollToHash(!!overview.data)

  if (overview.isLoading) {
    return (
      <div className="flex flex-col gap-10" aria-busy="true">
        <Skeleton className="h-11 w-72" />
        <Skeleton className="h-64" />
        <Skeleton className="h-48" />
      </div>
    )
  }
  if (!overview.data) {
    return (
      <EmptyState
        title={t('loadError')}
        description={errorMessage(overview.error)}
        action={
          <Button variant="outline" onClick={() => overview.refetch()}>
            {t('tryAgain')}
          </Button>
        }
      />
    )
  }

  const { user } = overview.data
  const hasPassword = security.data?.hasPassword !== false

  return (
    <div className="flex flex-col">
      <AccountHeader title={t('nav.details')} description={t('details.description')} />
      <div className="flex flex-col divide-y divide-hairline [&>*]:py-10 [&>*:first-child]:pt-2">
        <ProfileForm user={user} hasPassword={hasPassword} />
        <PasswordForm email={user.email} hasPassword={hasPassword} locale={locale} />
        <Preferences newsletter={user.newsletter} />
      </div>
    </div>
  )
}

export default Details

/** `/details/#password` from the overview: scroll the section into view once it has rendered. */
function useScrollToHash(ready: boolean) {
  const hash = useLocation({ select: (l) => l.hash })
  useEffect(() => {
    if (!ready || !hash) return
    const el = document.getElementById(hash.replace(/^#/, ''))
    el?.scrollIntoView({ block: 'start' })
  }, [ready, hash])
}
