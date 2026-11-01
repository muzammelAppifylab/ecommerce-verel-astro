/* The account app's routes (VAREL src/routes/_site/account/**), code-based. The host page
   (src/pages/account/[...path].astro) answers every /account/* URL and has already sent guests to sign in;
   a 401 from any later call does the same here (AccountApp's QueryCache). Screens are lazy; each route's
   loader warms the queries it reads (errors are swallowed: the screen shows its own error state). */
import type { QueryClient } from '@tanstack/react-query'
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  type AnyRoute,
} from '@tanstack/react-router'
import type { ComponentType } from 'react'
import { EmptyState } from '@/components/varel'
import { AccountShell } from './AccountShell'
import { AppLink } from './AppLink'
import { useAccountT } from './i18n'
import { addressesQuery, overviewQuery, securityQuery } from './queries'
import { appPaths } from './ui/orderUtils'
import { outlineAction } from './ui/recipes'

export interface AccountRouterContext {
  queryClient: QueryClient
}

/* WP-14 owns the order screens (src/account/screens/orders/{OrderHistory,OrderDetails}.tsx, default exports).
   They are found by file, so this app builds before and after that package lands. */
const orderScreens = import.meta.glob<{ default: ComponentType }>('./screens/orders/{OrderHistory,OrderDetails}.tsx')

function OrdersComingSoon() {
  const t = useAccountT('account')
  return (
    <EmptyState
      title={t('nav.orders')}
      description={t('ordersComingSoon')}
      action={
        <AppLink to={appPaths.account} className={outlineAction('px-6 py-3.5')}>
          {t('notFound.action')}
        </AppLink>
      }
    />
  )
}

function lazyOrderScreen(name: 'OrderHistory' | 'OrderDetails') {
  const load = orderScreens[`./screens/orders/${name}.tsx`]
  return load ? lazyRouteComponent(load) : OrdersComingSoon
}

export function AccountNotFound() {
  const t = useAccountT('account')
  return (
    <EmptyState
      title={t('notFound.title')}
      action={
        <AppLink to={appPaths.account} className={outlineAction('px-6 py-3.5')}>
          {t('notFound.action')}
        </AppLink>
      }
    />
  )
}

const warm = (qc: QueryClient, ...queries: Parameters<QueryClient['ensureQueryData']>[0][]) =>
  Promise.all(queries.map((q) => qc.ensureQueryData(q).catch(() => undefined))).then(() => undefined)

const rootRoute = createRootRouteWithContext<AccountRouterContext>()({
  component: AccountShell,
  notFoundComponent: AccountNotFound,
})

const overviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  staticData: { title: 'account:title' },
  loader: ({ context }) => warm(context.queryClient, overviewQuery),
  component: lazyRouteComponent(() => import('./screens/Overview'), 'Overview'),
})

const ordersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/orders/',
  staticData: { title: 'account:nav.orders' },
  // VAREL validateOrdersSearch: only `status` is read (WP-14 checks its value).
  validateSearch: (raw: Record<string, unknown>): { status?: string } =>
    typeof raw.status === 'string' && raw.status ? { status: raw.status.slice(0, 40) } : {},
  component: lazyOrderScreen('OrderHistory'),
})

const orderRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/orders/$number/',
  staticData: { title: 'orders:orderNumber' },
  component: lazyOrderScreen('OrderDetails'),
})

const detailsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/details/',
  staticData: { title: 'account:nav.details' },
  loader: ({ context }) => warm(context.queryClient, overviewQuery, securityQuery),
  component: lazyRouteComponent(() => import('./screens/Details'), 'Details'),
})

const addressesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/addresses/',
  staticData: { title: 'account:nav.addresses' },
  loader: ({ context }) => warm(context.queryClient, addressesQuery),
  component: lazyRouteComponent(() => import('./screens/Addresses'), 'Addresses'),
})

const downloadsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/downloads/',
  staticData: { title: 'account:nav.downloads' },
  loader: ({ context }) => warm(context.queryClient, overviewQuery),
  component: lazyRouteComponent(() => import('./screens/Downloads'), 'Downloads'),
})

const privacyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/privacy/',
  staticData: { title: 'account:privacy.title' },
  loader: ({ context }) => warm(context.queryClient, securityQuery),
  component: lazyRouteComponent(() => import('./screens/Privacy'), 'Privacy'),
})

export const accountRouteTree = rootRoute.addChildren([
  overviewRoute,
  ordersRoute,
  orderRoute,
  detailsRoute,
  addressesRoute,
  downloadsRoute,
  privacyRoute,
] as AnyRoute[])

/** One router per app instance: `basepath` is `/account` or `/da/account`. */
export function createAccountRouter(queryClient: QueryClient, basepath: string) {
  return createRouter({
    routeTree: accountRouteTree,
    basepath,
    trailingSlash: 'always',
    context: { queryClient },
    defaultPreload: 'intent',
    // Query owns the cache (staleTime per query); the router never keeps loader results itself.
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
  })
}
