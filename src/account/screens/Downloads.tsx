/* /account/downloads/ — files from paid digital orders (VAREL DownloadsPage). Files are private platform files:
   the button asks the download route for a short-lived link through siteFetch (the session travels with it, also
   in the editor Preview), then the browser follows it. Only the clicked row shows pending; a failure shows under
   that row. */
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Button, EmptyState, Icon, Skeleton, Spinner } from '@/components/varel'
import { errorMessage, isApiError } from '@/lib/storefront-api'
import { AccountHeader } from '../AccountShell'
import { AppLink } from '../AppLink'
import { useAccountT } from '../i18n'
import { overviewQuery, useDownload } from '../queries'
import { appPaths, isPlatformFileId } from '../ui/orderUtils'
import { outlineAction } from '../ui/recipes'
import { useTitle } from '../useTitle'

export function Downloads() {
  const t = useAccountT('account')
  const to = useAccountT('orders')
  useTitle(t('nav.downloads'))
  const q = useQuery(overviewQuery)
  const download = useDownload()
  const [active, setActive] = useState<string | null>(null)
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null)

  if (q.isLoading) {
    return (
      <div className="flex flex-col gap-8" aria-busy="true">
        <Skeleton className="h-11 w-60" />
        <Skeleton className="h-40" />
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

  const start = (key: string, file: string) => {
    if (download.isPending) return
    setActive(key)
    setFailed(null)
    download.mutate(file, {
      onError: (err) => {
        const message =
          isApiError(err) && (err.code === 'download_unavailable' || err.status === 404) ? t('downloadError') : errorMessage(err, t('downloadError'))
        setFailed({ key, message })
      },
      onSettled: () => setActive(null),
    })
  }

  const { downloads } = q.data
  return (
    <div className="flex flex-col">
      <AccountHeader title={t('nav.downloads')} description={t('downloadsDescription')} />
      {downloads.length === 0 ? (
        <p className="m-0 bg-chalk p-7 text-[15px] text-text-secondary">{t('noDownloads')}</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {downloads.map((d) => {
            const key = d.orderNumber + d.file
            const busy = active === key
            const error = failed?.key === key ? failed.message : null
            return (
              <li
                key={key}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-1 border-b border-hairline py-5 first:pt-0"
              >
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="font-display text-[21px] leading-snug">{d.name}</span>
                  <span className="truncate text-[13.5px] text-text-secondary">
                    {!isPlatformFileId(d.file) && <>{d.file} · </>}
                    <AppLink to={appPaths.order} params={{ number: d.orderNumber }} className="text-[13.5px]">
                      {to('orderNumber', { number: d.orderNumber })}
                    </AppLink>
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => start(key, d.file)}
                  disabled={download.isPending}
                  aria-busy={busy ? true : undefined}
                  className={outlineAction('px-[18px] py-[11px]')}
                >
                  {busy ? <Spinner size={14} /> : <Icon name="download" size={14} />}
                  {busy ? t('downloading') : t('download')}
                </button>
                {error && (
                  <p role="alert" className="col-span-2 m-0 text-body-xs text-signal-critical">
                    {error}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export default Downloads
