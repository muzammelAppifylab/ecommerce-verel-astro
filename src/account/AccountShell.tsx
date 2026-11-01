/* Frame for every /account screen (VAREL src/pages/account/AccountShell.tsx): breadcrumb, the account menu
   (sticky column on desktop, scrolling chip row on phones) and the screen itself. Screens render their own <h1>
   through `AccountHeader`. Counts come from the overview (one read), never from a full order list. */
import { useQuery } from '@tanstack/react-query'
import { Outlet, useLocation } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { Breadcrumb, Icon, Spinner, type IconName } from '@/components/varel'
import { cn } from '@/lib/utils'
import { AppLink } from './AppLink'
import { useAccountContext, useAccountT } from './i18n'
import { overviewQuery, useSignOut } from './queries'
import { inAppPath, sectionOf, type Section } from './paths'
import { accountLinks, appPaths } from './ui/orderUtils'

const NAV: { key: Section; icon: IconName; to: string; external?: boolean }[] = [
  { key: 'overview', icon: 'user', to: appPaths.account },
  { key: 'orders', icon: 'package', to: appPaths.orders },
  { key: 'wishlist', icon: 'heart', to: '', external: true },
  { key: 'details', icon: 'pencil', to: appPaths.details },
  { key: 'addresses', icon: 'map-pin', to: appPaths.addresses },
  { key: 'downloads', icon: 'download', to: appPaths.downloads },
  { key: 'privacy', icon: 'lock', to: appPaths.privacy },
]

export { inAppPath, sectionOf, type Section }

/** The root route's component: the frame plus the current screen. */
export function AccountShell() {
  return (
    <AccountFrame>
      <Outlet />
    </AccountFrame>
  )
}

export function AccountFrame({ children }: { children: ReactNode }) {
  const t = useAccountT('account')
  const { basepath, locale } = useAccountContext()
  const pathname = useLocation({ select: (l) => l.pathname })
  const path = inAppPath(pathname, basepath)
  const section = sectionOf(path)
  const orderNumber = section === 'orders' ? path.split('/').filter(Boolean)[1] : undefined
  const links = accountLinks(locale)

  const crumbs: { label: string; href?: string }[] = [
    { label: t('crumbs.home'), href: links.home },
    { label: t('crumbs.account'), href: section === 'overview' ? undefined : links.account },
  ]
  if (section !== 'overview') crumbs.push({ label: t(`nav.${section}`), href: orderNumber ? links.orders : undefined })
  if (orderNumber) crumbs.push({ label: safeDecode(orderNumber) })

  return (
    <div className="mx-auto w-full max-w-page px-6 pt-6 pb-24 md:px-12">
      <Breadcrumb items={crumbs} />
      <div className="mt-8 grid grid-cols-1 items-start gap-8 lg:mt-10 lg:grid-cols-[248px_minmax(0,1fr)] lg:gap-14 xl:gap-20">
        <AccountMenu section={section} />
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  )
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

function AccountMenu({ section }: { section: Section }) {
  const t = useAccountT('account')
  const { locale } = useAccountContext()
  const overview = useQuery(overviewQuery)
  const signOut = useSignOut()
  const data = overview.data
  const user = data?.user
  const orderCount = data?.orderCount ?? data?.recentOrders.length
  const counts: Partial<Record<Section, number | string>> = {
    orders: orderCount != null && orderCount >= 100 ? t('ordersMore') : orderCount,
    wishlist: data?.wishlistCount,
    downloads: data?.downloads.length,
  }
  // Downloads only matter to people who bought something digital.
  const items = NAV.filter((n) => n.key !== 'downloads' || Number(counts.downloads ?? 0) > 0 || section === 'downloads')
  const initials = user ? `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`.toUpperCase() : ''
  const links = accountLinks(locale)

  return (
    <aside className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-28">
      {user && (
        <div className="hidden items-center gap-3.5 lg:flex">
          <span
            aria-hidden
            className="flex size-12 shrink-0 items-center justify-center bg-ink-900 font-display text-[19px] text-ink-000 [font-variant-numeric:lining-nums]"
          >
            {initials}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[16px] text-text-primary">{user.name}</span>
            <span className="truncate text-[13px] text-text-secondary">{user.email}</span>
          </span>
        </div>
      )}

      <nav aria-label={t('nav.label')} className="-mx-6 overflow-x-auto px-6 lg:mx-0 lg:overflow-visible lg:px-0">
        <ul className="m-0 flex list-none gap-1.5 p-0 lg:flex-col lg:gap-0 lg:border-t lg:border-hairline">
          {items.map((n) => {
            const on = n.key === section
            const count = counts[n.key]
            const className = cn(
              'group relative flex items-center gap-3 border-0 text-[14.5px] whitespace-nowrap no-underline transition-hover',
              // phones: bordered chips; desktop: full-width rows with an ink bar on the current one
              'max-lg:h-10 max-lg:border max-lg:border-hairline max-lg:px-3.5',
              'lg:h-12 lg:px-3',
              on
                ? 'text-text-primary max-lg:border-ink-900 max-lg:bg-ink-900 max-lg:text-ink-000 lg:bg-chalk lg:before:absolute lg:before:inset-y-0 lg:before:left-0 lg:before:w-0.5 lg:before:bg-ink-900'
                : 'text-text-secondary hover:text-text-primary lg:hover:bg-chalk',
            )
            const inner = (
              <>
                <Icon
                  name={n.icon}
                  size={16}
                  className={cn('max-lg:hidden', on ? 'text-text-primary' : 'text-text-muted group-hover:text-text-primary')}
                />
                <span className="flex-1">{t(`nav.${n.key}`)}</span>
                {!!count && (
                  <span className={cn('text-[12.5px] tabular-nums', on ? 'max-lg:text-ink-300 lg:text-text-secondary' : 'text-text-muted')}>
                    {count}
                  </span>
                )}
              </>
            )
            return (
              <li key={n.key} className="shrink-0 lg:border-b lg:border-hairline">
                {n.external ? (
                  // The wishlist is a storefront page: it leaves the app.
                  <a href={links.wishlist} className={className}>
                    {inner}
                  </a>
                ) : (
                  <AppLink to={n.to} aria-current={on ? 'page' : undefined} className={className}>
                    {inner}
                  </AppLink>
                )}
              </li>
            )
          })}
        </ul>
      </nav>

      <div className="hidden flex-col gap-4 lg:flex">
        <button
          type="button"
          onClick={() => signOut.mutate()}
          disabled={signOut.isPending}
          aria-busy={signOut.isPending ? true : undefined}
          className="flex h-10 cursor-pointer items-center gap-3 self-start border-0 bg-transparent px-3 text-[14.5px] text-text-secondary transition-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {signOut.isPending ? <Spinner size={16} /> : <Icon name="log-out" size={16} className="text-text-muted" />}
          {signOut.isPending ? t('signingOut') : t('signOut')}
        </button>
        <div className="flex flex-col gap-1.5 bg-chalk p-4 text-[13px] leading-snug">
          <span className="text-text-primary">{t('help.title')}</span>
          <span className="text-text-secondary">{t('help.body')}</span>
          <a href={links.contact} className="mt-1 self-start text-[13px]">
            {t('help.contact')}
          </a>
        </div>
      </div>
    </aside>
  )
}

/** Page heading inside the account frame: serif title, optional one-line description, optional actions.
    Exported for WP-14's order screens. */
export function AccountHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-x-8 gap-y-4 border-b border-hairline pb-6">
      <div className="flex min-w-0 flex-col gap-2">
        <h1 className="m-0 font-display text-[34px] leading-[1.1] font-normal tracking-display [font-variant-numeric:lining-nums] md:text-[42px]">
          {title}
        </h1>
        {description && <p className="m-0 max-w-[60ch] text-[15px] leading-body text-text-secondary">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </header>
  )
}
