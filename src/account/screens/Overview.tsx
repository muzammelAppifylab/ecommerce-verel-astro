/* /account/ — what a returning customer looks for first: the latest order, then their details at a glance.
   Port of VAREL src/pages/Account.tsx. Storefront pages are plain links (they leave the app); in-app links
   go through the router (`AppLink`). */
import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Button, EmptyState, Icon, Img, Skeleton, type IconName } from '@/components/varel'
import { money } from '@/lib/format'
import { productLink } from '@/lib/links'
import { errorMessage } from '@/lib/storefront-api'
import type { Order } from '@/lib/types/orders'
import { cn } from '@/lib/utils'
import { AccountHeader } from '../AccountShell'
import { AppLink } from '../AppLink'
import { useAccountContext, useAccountT } from '../i18n'
import { overviewQuery } from '../queries'
import { StatusChip } from '../ui/StatusChip'
import { accountLinks, addressBlock, appPaths, orderUnits } from '../ui/orderUtils'
import { outlineAction, underlineAction } from '../ui/recipes'
import { useTitle } from '../useTitle'

const STAGES = ['received', 'processing', 'packed', 'shipped', 'delivered'] as const

export function Overview() {
  const t = useAccountT('account')
  const { locale } = useAccountContext()
  useTitle(t('title'))
  const overview = useQuery(overviewQuery)

  if (overview.isLoading) return <OverviewSkeleton />

  if (overview.isError || !overview.data) {
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

  const links = accountLinks(locale)
  const { user, addresses, recentOrders, wishlistCount, downloads } = overview.data
  const [latest, ...earlier] = recentOrders
  const home = addresses.find((a) => a.primary) ?? addresses[0]

  return (
    <div className="flex flex-col gap-14">
      <AccountHeader title={t('greeting', { name: user.firstName })} description={t('since', { date: user.since })} />

      {latest ? (
        <LatestOrder order={latest} />
      ) : (
        <section className="flex flex-col items-start gap-4 bg-chalk p-7 md:p-9">
          <h2 className="m-0 font-display text-[26px] leading-tight font-normal">{t('noOrders.title')}</h2>
          <p className="m-0 max-w-[52ch] text-[15px] leading-body text-text-secondary">{t('noOrders.description')}</p>
          <a href={links.shop} className={outlineAction('mt-2 px-6 py-3.5')}>
            {t('noOrders.action')}
          </a>
        </section>
      )}

      <section aria-labelledby="summary-title" className="flex flex-col gap-4">
        <h2 id="summary-title" className="m-0 font-display text-[26px] leading-tight font-normal">
          {t('summary.title')}
        </h2>
        <ul className="m-0 list-none border-t border-hairline p-0">
          <SummaryRow icon="pencil" to={appPaths.details} title={t('nav.details')} value={`${user.name} · ${user.email}`} />
          <SummaryRow
            icon="map-pin"
            to={appPaths.addresses}
            title={t('nav.addresses')}
            value={home ? t('summary.defaultAddress', { address: addressBlock(home, locale) }) : t('summary.noAddress')}
            muted={!home}
          />
          <SummaryRow
            icon="mail"
            to={appPaths.details}
            hash="preferences"
            title={t('summary.newsletter')}
            value={user.newsletter ? t('summary.subscribed') : t('summary.notSubscribed')}
            muted={!user.newsletter}
          />
          <SummaryRow
            icon="heart"
            href={links.wishlist}
            title={t('nav.wishlist')}
            value={wishlistCount ? t('summary.saved', { count: wishlistCount }) : t('summary.noSaved')}
            muted={!wishlistCount}
          />
          {downloads.length > 0 && (
            <SummaryRow
              icon="download"
              to={appPaths.downloads}
              title={t('nav.downloads')}
              value={t('summary.files', { count: downloads.length })}
            />
          )}
          <SummaryRow icon="lock" to={appPaths.details} hash="password" title={t('summary.password')} value={t('summary.passwordHint')} muted />
        </ul>
      </section>

      {earlier.length > 0 && (
        <section aria-labelledby="earlier-title" className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between gap-6">
            <h2 id="earlier-title" className="m-0 font-display text-[26px] leading-tight font-normal">
              {t('earlier')}
            </h2>
            <AppLink to={appPaths.orders} className={underlineAction('pb-1')}>
              {t('allOrders')}
            </AppLink>
          </div>
          <ul className="m-0 list-none border-t border-hairline p-0">
            {earlier.map((o) => (
              <OrderRow key={o.number} order={o} />
            ))}
          </ul>
        </section>
      )}

      <HelpLinks />
    </div>
  )
}

export default Overview

/** The newest order: where it is, what is in it, and what can be done with it now. */
function LatestOrder({ order: o }: { order: Order }) {
  const t = useAccountT('account')
  const to = useAccountT('orders')
  const { locale } = useAccountContext()
  const links = accountLinks(locale)
  const cancelled = o.fulfillment === 'Cancelled' || o.fulfillment === 'Returned'
  const returnable = o.fulfillment === 'Shipped' || o.fulfillment === 'Delivered'
  const shown = o.items.slice(0, 4)
  const more = o.items.length - shown.length

  return (
    <section aria-labelledby="latest-title" className="flex flex-col border border-hairline">
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-3 px-6 pt-6 md:px-8 md:pt-7">
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="text-[13.5px] text-text-secondary">{t('latest.label')}</span>
          <h2 id="latest-title" className="m-0 font-display text-[28px] leading-tight font-normal [font-variant-numeric:lining-nums]">
            {to('orderNumber', { number: o.number })}
          </h2>
          <span className="text-[14px] text-text-secondary tabular-nums">
            {t('latest.meta', { date: o.date, items: t('items', { count: orderUnits(o) }), total: money(o.total, o.currency, locale) })}
          </span>
        </div>
        <StatusChip status={o.fulfillment} className="mt-1" />
      </div>

      {!cancelled && (
        <ol aria-label={t('latest.progress')} className="m-0 grid list-none grid-cols-5 gap-1.5 px-6 pt-6 md:px-8">
          {STAGES.map((stage, i) => {
            const done = i <= o.stage
            const current = i === o.stage
            return (
              <li key={stage} aria-current={current ? 'step' : undefined} className="flex min-w-0 flex-col gap-2">
                <span aria-hidden className={cn('h-[3px]', done ? 'bg-ink-900' : 'bg-ink-100')} />
                <span
                  className={cn(
                    'truncate text-[12.5px]',
                    current ? 'text-text-primary' : done ? 'text-text-secondary' : 'text-text-secondary/70',
                    !current && 'max-sm:sr-only',
                  )}
                >
                  {to(`stages.${stage}`)}
                  {done && !current && <span className="sr-only"> ✓</span>}
                </span>
              </li>
            )
          })}
        </ol>
      )}

      <ul className="m-0 flex list-none flex-wrap gap-3 px-6 pt-6 md:px-8">
        {shown.map((l) => (
          <li key={l.lineId}>
            {l.productId ? (
              <a href={productLink(l.productId, locale)} className="block w-[72px] border-0" title={l.name}>
                <Img photo={l.image} alt={l.name} ratio="3/4" width={160} sizes="72px" media={false} />
              </a>
            ) : (
              <span className="block w-[72px]" title={l.name}>
                <Img photo={l.image} alt={l.name} ratio="3/4" width={160} sizes="72px" media={false} />
              </span>
            )}
          </li>
        ))}
        {more > 0 && (
          <li className="flex aspect-[3/4] w-[72px] items-center justify-center bg-chalk text-[13px] text-text-secondary">+{more}</li>
        )}
      </ul>

      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-hairline px-6 py-5 md:px-8">
        <AppLink to={appPaths.order} params={{ number: o.number }} className={outlineAction('px-5 py-3')}>
          {t('latest.view')}
        </AppLink>
        {o.trackingUrl && (
          <a href={o.trackingUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-[14px]">
            <Icon name="truck" size={16} />
            {t('latest.track', { carrier: o.carrier ?? '' }).trim()}
          </a>
        )}
        {returnable && (
          <a href={links.returns(o.number)} className="inline-flex items-center gap-2 text-[14px]">
            <Icon name="rotate-ccw" size={16} />
            {t('latest.return')}
          </a>
        )}
        {o.canCancel && <span className="text-[13px] text-text-secondary">{t('latest.canCancel')}</span>}
      </div>
    </section>
  )
}

const ROW =
  'group grid grid-cols-[20px_minmax(0,1fr)_16px] items-center gap-x-4 border-0 py-4 text-text-primary no-underline transition-hover hover:bg-chalk sm:grid-cols-[20px_180px_minmax(0,1fr)_16px] sm:px-2'

function SummaryRow({
  icon,
  to,
  href,
  hash,
  title,
  value,
  muted,
}: {
  icon: IconName
  /** In-app path */
  to?: string
  /** Storefront href (leaves the app) */
  href?: string
  hash?: string
  title: string
  value: ReactNode
  muted?: boolean
}) {
  const inner = (
    <>
      <Icon name={icon} size={16} className="text-text-secondary" />
      <span className="text-[15px]">{title}</span>
      <span className={cn('col-start-2 truncate text-[14px] sm:col-start-auto', muted ? 'text-text-secondary' : 'text-text-primary')}>
        {value}
      </span>
      <Icon
        name="chevron-right"
        size={16}
        className="col-start-3 row-span-2 row-start-1 text-text-secondary transition-transform group-hover:translate-x-0.5 sm:col-start-auto sm:row-span-1 sm:row-start-auto"
      />
    </>
  )
  return (
    <li className="border-b border-hairline">
      {href ? (
        <a href={href} className={ROW}>
          {inner}
        </a>
      ) : (
        <AppLink to={to ?? appPaths.account} hash={hash} className={ROW}>
          {inner}
        </AppLink>
      )}
    </li>
  )
}

function OrderRow({ order: o }: { order: Order }) {
  const t = useAccountT('account')
  const to = useAccountT('orders')
  const { locale } = useAccountContext()
  const first = o.items[0]
  return (
    <li className="border-b border-hairline">
      <AppLink
        to={appPaths.order}
        params={{ number: o.number }}
        className="group grid grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-0 py-4 text-text-primary no-underline transition-hover hover:bg-chalk sm:grid-cols-[48px_minmax(0,1fr)_140px_110px_16px] sm:px-2"
      >
        <span className="row-span-2 block w-12 sm:row-span-1">
          {first && <Img photo={first.image} alt="" ratio="3/4" width={120} sizes="48px" media={false} />}
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[15px] [font-variant-numeric:lining-nums]">{to('orderNumber', { number: o.number })}</span>
          <span className="truncate text-[13.5px] text-text-secondary">
            {o.date} · {t('items', { count: orderUnits(o) })}
          </span>
        </span>
        <StatusChip status={o.fulfillment} className="col-start-2 sm:col-start-auto" />
        <span className="row-start-1 text-right text-[15px] tabular-nums sm:row-start-auto">{money(o.total, o.currency, locale)}</span>
        <Icon name="chevron-right" size={16} className="text-text-secondary max-sm:hidden" />
      </AppLink>
    </li>
  )
}

function HelpLinks() {
  const t = useAccountT('account')
  const { locale } = useAccountContext()
  const links = accountLinks(locale)
  const items: { icon: IconName; label: string; href: string }[] = [
    { icon: 'rotate-ccw', label: t('help.returns'), href: links.returns() },
    { icon: 'info', label: t('help.terms'), href: links.terms },
    { icon: 'mail', label: t('help.contact'), href: links.contact },
  ]
  return (
    <section aria-labelledby="help-title" className="flex flex-col gap-4 bg-chalk p-6 md:p-8">
      <div className="flex flex-col gap-1">
        <h2 id="help-title" className="m-0 font-display text-[24px] leading-tight font-normal">
          {t('help.title')}
        </h2>
        <p className="m-0 text-[14.5px] text-text-secondary">{t('help.body')}</p>
      </div>
      <ul className="m-0 flex list-none flex-wrap gap-x-8 gap-y-3 p-0">
        {items.map((l) => (
          <li key={l.label}>
            <a href={l.href} className="inline-flex items-center gap-2 text-[14.5px]">
              <Icon name={l.icon} size={16} />
              {l.label}
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function OverviewSkeleton() {
  return (
    <div className="flex flex-col gap-14" aria-busy="true">
      <div className="flex flex-col gap-3 border-b border-hairline pb-6">
        <Skeleton className="h-11 w-72 max-w-full" />
        <Skeleton className="h-4 w-48" />
      </div>
      <Skeleton className="h-[300px]" />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-7 w-40" />
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    </div>
  )
}
