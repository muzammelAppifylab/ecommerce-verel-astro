import {type QueryClient, useQuery} from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  createRoute,
  type ErrorComponentProps,
  Link,
  lazyRouteComponent,
  Outlet,
  redirect,
  useMatches,
  useNavigate,
  useRouter,
  useRouterState,
} from '@tanstack/react-router';
import {type ReactNode, useEffect, useRef, useState} from 'react';

import {logout} from '../platform/browser';
import {type AreaAbility, hasAbility} from './api';
import {
  auditQuery,
  firstAuditQuery,
  firstUsersQuery,
  healthQuery,
  loadAbandoned,
  loadActivity,
  loadAnalytics,
  loadCategoryOrder,
  loadCollection,
  loadCollections,
  loadCustomer,
  loadCustomers,
  loadDepartments,
  loadDiscount,
  loadDiscounts,
  loadEmails,
  loadInventory,
  loadLanguages,
  loadNavigation,
  loadNewDiscount,
  loadNewPost,
  loadNewProduct,
  loadOrder,
  loadOrders,
  loadOverview,
  loadPage,
  loadPages,
  loadPost,
  loadPosts,
  loadProduct,
  loadProducts,
  loadReturn,
  loadReturns,
  loadReviews,
  loadSettings,
  loadStaff,
  loadSubscribers,
  meQuery,
  type NavCounts,
  navCountsQuery,
  permissionsQuery,
  rolesQuery,
  sessionsQuery,
  type SettingsSection,
  siteQuery,
  twoFactorQuery,
  usersQuery,
  validateActivitySearch,
  validateAnalyticsSearch,
  validateCustomersSearch,
  validateDashboardSearch,
  validateDiscountEditSearch,
  validateDiscountsSearch,
  validateEmailsSearch,
  validateInventorySearch,
  validateJournalListSearch,
  validateNewDiscountSearch,
  validateOrdersSearch,
  validateProductsSearch,
  validateReturnsSearch,
  validateReviewsSearch,
  validateSubscribersSearch,
  validateTranslationsSearch,
} from './queries';
import {useMe, useSite} from './shared';
import {
  Avatar,
  Button,
  buttonClass,
  Card,
  ConfirmProvider,
  EmptyState,
  Icon,
  IconButton,
  type IconName,
  LoadingBlock,
  Menu,
  PageHeader,
  ToastProvider,
} from './ui';

/**
 * The portal's screens: a TanStack Router app under `/dashboard` (basepath),
 * served by `src/pages/dashboard/[...path].astro` (signed-in users only), with
 * data from the Site API through TanStack Query. Links INSIDE the portal use
 * `<Link>`; links to the website (`/`, `/journal/`, `/account/…`) are plain
 * `<a href>`.
 *
 * THE screen registry of the VAREL admin (docs/migration/PLAN.md §5 F5): one route
 * per VAREL `/admin/*` route, each pointing at its area's screen
 * (`screens/<area>/index.tsx`, lazy) and its area's search validator and loader
 * (`queries/<area>.ts`). Feature packages fill those two files; this one stays as
 * it is. A new screen still needs all five steps:
 *   1. its reads as `queryOptions` in `queries/<area>.ts`, used by the screen with `useQuery(x)`;
 *   2. the component in `screens/<area>/` (a named export from its `index.tsx`);
 *   3. a `createRoute` below: literal `path`, `staticData.title` (the top bar
 *      and the tab), `validateSearch` when it reads the URL, a `loader` that warms
 *      its queries, and the component LAZY (`lazyRouteComponent(() => import(…), 'Name')`)
 *      so its code loads on first use (or on hover), never in the first bundle;
 *   4. its route in `routeTree`;
 *   5. one item in `NAV_GROUPS` if it belongs in the sidebar.
 * Never a plain `<a href>` to a portal path: it reloads the whole app.
 */

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    /** The screen's name: the top bar's `<h1>` and the tab's title. */
    title?: string;
  }
}

/**
 * Warm a screen's queries before it renders (on navigation, and on hover via
 * `defaultPreload: 'intent'`). A failed read is NOT thrown: the screen shows
 * the error in place from the same query, as it always has.
 */
const warm = (...reads: Promise<unknown>[]) => Promise.all(reads.map(read => read.catch(() => undefined))).then(() => undefined);

/** While a slow screen loads (after `defaultPendingMs`). */
export function RoutePending() {
  return (
    <div className="app-page">
      <LoadingBlock rows={4} />
    </div>
  );
}

/** A screen that failed to render or to load its code (an old tab after a Publish: reload). */
export function RouteError({error}: ErrorComponentProps) {
  const router = useRouter();
  const failure = error instanceof Error ? error : new Error('Something went wrong.');
  const stale = /dynamically imported module|module script|Importing a module/i.test(failure.message);
  return (
    <div className="app-page">
      <EmptyState
        icon={stale ? 'refresh' : 'alert'}
        title={stale ? 'This dashboard was updated' : 'This screen could not load'}
        action={
          <Button variant="secondary" icon="refresh" onClick={() => (stale ? window.location.reload() : void router.invalidate())}>
            {stale ? 'Reload' : 'Try again'}
          </Button>
        }>
        {stale ? 'Reload to get the new version.' : failure.message}
      </EmptyState>
    </div>
  );
}

type NavItem = {
  to: string;
  label: string;
  icon: IconName;
  exact?: boolean;
  /** Hides the item from people without it (and shows "no access" on its screens). */
  ability?: AreaAbility;
  /** A counter shown beside the item when above zero. */
  count?: keyof NavCounts;
};

/**
 * The sidebar, in VAREL's groups (`components/admin/nav.ts`). `ability` hides an
 * item the visitor may not use; that only HIDES it, the route's guard is the
 * enforcement. A group with no visible item is not shown. Translations, Emails
 * and Shipping live under Settings, which is pinned to the foot.
 */
const NAV_GROUPS: {label: string; items: NavItem[]}[] = [
  {
    label: 'Overview',
    items: [
      {to: '/', label: 'Dashboard', icon: 'dashboard', exact: true},
      {to: '/analytics', label: 'Analytics', icon: 'bar-chart', ability: 'viewAnalytics'},
    ],
  },
  {
    label: 'Sales',
    items: [
      {to: '/orders', label: 'Orders', icon: 'shopping-bag', ability: 'manageOrders', count: 'openOrders'},
      {to: '/returns', label: 'Returns', icon: 'rotate-ccw', ability: 'manageOrders', count: 'pendingReturns'},
      {to: '/abandoned', label: 'Abandoned bags', icon: 'shopping-cart', ability: 'manageOrders'},
      {to: '/customers', label: 'Customers', icon: 'users', ability: 'manageCustomers'},
      {to: '/subscribers', label: 'Subscribers', icon: 'mail-plus', ability: 'manageCustomers'},
    ],
  },
  {
    label: 'Catalog',
    items: [
      {to: '/products', label: 'Products', icon: 'package', ability: 'manageProducts'},
      {to: '/inventory', label: 'Inventory', icon: 'boxes', ability: 'manageProducts'},
      {to: '/catalog', label: 'Departments', icon: 'list-tree', ability: 'manageProducts'},
      {to: '/collections', label: 'Collections', icon: 'layers', ability: 'manageProducts'},
      {to: '/reviews', label: 'Reviews', icon: 'star', ability: 'manageProducts'},
    ],
  },
  {
    label: 'Store',
    items: [
      {to: '/discounts', label: 'Discounts', icon: 'percent', ability: 'manageDiscounts'},
      {to: '/staff', label: 'Staff', icon: 'user-cog', ability: 'manageUsers'},
      {to: '/users', label: 'Users', icon: 'user', ability: 'manageUsers'},
      {to: '/roles', label: 'Roles', icon: 'shield', ability: 'manageRoles'},
      {to: '/activity', label: 'Activity', icon: 'activity', ability: 'readAudit'},
    ],
  },
  {
    label: 'Content',
    items: [
      {to: '/journal', label: 'Journal', icon: 'file-text', ability: 'manageContent'},
      {to: '/pages', label: 'Pages', icon: 'files', ability: 'manageContent'},
      {to: '/navigation', label: 'Navigation', icon: 'navigation', ability: 'manageContent'},
    ],
  },
  // Only in the Preview and `npm run dev` (never in a build): the UI kit, on screen.
  ...(import.meta.env.DEV ? [{label: 'Build', items: [{to: '/components', label: 'Components', icon: 'layers' as const}]}] : []),
];

/** Pinned below the groups: anyone with the settings or the content area (Languages is content). */
const SETTINGS_ITEM: NavItem = {to: '/settings', label: 'Settings', icon: 'settings'};
const canOpenSettings = (abilities: object | undefined) => hasAbility(abilities, 'manageStoreSettings') || hasAbility(abilities, 'manageContent');

/** The nav item that owns a path (longest prefix; the dashboard only on an exact match). */
export function navItemFor(pathname: string): NavItem | null {
  let best: NavItem | null = null;
  for (const group of NAV_GROUPS)
    for (const item of group.items) {
      const hit = item.exact ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`);
      if (hit && (!best || item.to.length > best.to.length)) best = item;
    }
  return best;
}

/** The screen's title for the top bar and the tab: the deepest route's `staticData.title`. */
function useScreenTitle() {
  const matches = useMatches();
  return [...matches].reverse().find(match => match.staticData.title)?.staticData.title ?? 'Dashboard';
}

/**
 * After every in-app navigation (never the first load): the tab title says
 * where you are, and focus moves to the screen's `<h1>` so keyboard and
 * screen reader users start at the new screen (it is read out), as after a
 * page load.
 */
function useNavigationFocus(title: string, siteName: string | undefined) {
  const heading = useRef<HTMLHeadingElement>(null);
  const resolved = useRouterState({select: s => s.resolvedLocation?.pathname});
  const first = useRef(true);
  // "<title> · <site>", as App.astro writes it on the first load.
  const [fallbackName] = useState(() => document.title.split(' · ').slice(1).join(' · ') || 'VAREL');
  useEffect(() => {
    document.title = `${title} · ${siteName ?? fallbackName}`;
  }, [title, siteName, fallbackName]);
  useEffect(() => {
    if (!resolved) return;
    if (first.current) {
      first.current = false;
      return;
    }
    heading.current?.focus({preventScroll: true});
  }, [resolved]);
  return {heading, resolved};
}

type Theme = 'system' | 'light' | 'dark';
const THEME_KEY = 'site:theme';

/** Light, dark or the device's: `data-theme` on <html> (global.css), remembered in this browser. */
function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      return saved === 'light' || saved === 'dark' ? saved : 'system';
    } catch {
      return 'system';
    }
  });
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = theme;
    try {
      if (theme === 'system') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Storage blocked: the choice lasts until the tab closes.
    }
  }, [theme]);
  return [theme, setTheme] as const;
}

/**
 * The app shell: a full-height sidebar (wordmark, grouped nav with counters,
 * Settings and the way back to the website at the foot), a top bar (screen
 * title, View store, theme, the user's menu) and the screen in between; a
 * drawer with a scrim on small screens. Every screen renders inside it, with
 * toasts (`useToast`) and confirmations (`useConfirm`) mounted once here.
 * Nothing here reloads the page.
 */
const rootRoute = createRootRouteWithContext<{queryClient: QueryClient}>()({
  component: function Root() {
    return (
      <ToastProvider>
        <ConfirmProvider>
          <Shell />
        </ConfirmProvider>
      </ToastProvider>
    );
  },
  notFoundComponent: () => (
    <div className="app-page">
      <EmptyState
        icon="search"
        title="This page does not exist"
        action={
          <Link className={buttonClass({variant: 'secondary'})} to="/">
            Back to the dashboard
          </Link>
        }>
        The link may be old, or the page was moved.
      </EmptyState>
    </div>
  ),
});

function NavLink({item, count = 0}: {item: NavItem; count?: number}) {
  return (
    <Link to={item.to} className="app-nav-link" activeOptions={{exact: item.exact ?? false}}>
      <Icon name={item.icon} size={18} />
      <span className="app-nav-text">{item.label}</span>
      {count > 0 && (
        <span className="app-nav-badge" aria-label={`${count} need attention`}>
          {count}
        </span>
      )}
    </Link>
  );
}

/**
 * Staff who open a screen of an area they do not have (a direct link) see a
 * short notice instead of a wall of errors (VAREL `AccessGuard`). The API
 * refuses the data either way. Settings render their own read-only view.
 */
function AccessGate({pathname, abilities, children}: {pathname: string; abilities: object | undefined; children: ReactNode}) {
  const item = navItemFor(pathname);
  if (!item?.ability || !abilities || hasAbility(abilities, item.ability)) return <>{children}</>;
  return (
    <div className="app-page">
      <PageHeader title={item.label} />
      <Card>
        <div className="access-denied" role="alert">
          <span className="access-denied-icon">
            <Icon name="lock" size={16} />
          </span>
          <h3>You don&apos;t have access to {item.label.toLowerCase()}</h3>
          <p>Your role does not include this area. Ask an admin to add it to your role if you need it.</p>
          <Link to="/" className={buttonClass({variant: 'link'})}>
            Back to the dashboard
          </Link>
        </div>
      </Card>
    </div>
  );
}

function Shell() {
  const me = useMe();
  const site = useSite();
  const navigate = useNavigate();
  const title = useScreenTitle();
  const siteName = site.data?.site?.name;
  const {heading, resolved} = useNavigationFocus(title, siteName);
  const pathname = useRouterState({select: s => s.location.pathname.replace(/^\/dashboard/, '').replace(/\/$/, '') || '/'});
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useTheme();
  // `logout()` reloads the page when it is done, so pending never needs resetting.
  const [signingOut, setSigningOut] = useState(false);
  const viewer = me.data?.viewer;
  const abilities = me.data?.abilities;
  const counts = useQuery({...navCountsQuery, enabled: hasAbility(abilities, 'manageOrders')}).data;
  // Signed out meanwhile (or never signed in, in the editor Preview, where
  // the host page cannot see the session): go and sign in, then come back.
  const signedOut = viewer !== undefined && viewer.state !== 'user';
  useEffect(() => {
    if (!signedOut) return;
    const back = encodeURIComponent(`${window.location.pathname}${window.location.search}`);
    window.location.replace(`/account/login/?next=${back}`);
  }, [signedOut]);
  // The drawer closes on navigation and on Esc.
  useEffect(() => setOpen(false), [resolved]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  if (signedOut) return null;

  const name = siteName ?? 'VAREL';
  const logo = site.data?.site?.logo;
  return (
    <div className="app-shell" data-nav-open={open ? '' : undefined}>
      <aside className="app-sidebar" aria-label="Sidebar">
        <Link className="app-brand" to="/">
          {logo ? (
            <span className="app-brand-mark">
              <img src={logo} alt="" />
            </span>
          ) : null}
          <span className={logo ? 'app-brand-name' : 'app-brand-name app-brand-wordmark'}>{name}</span>
        </Link>
        <nav className="app-nav" aria-label="Dashboard">
          {NAV_GROUPS.map(group => {
            const items = group.items.filter(item => !item.ability || hasAbility(abilities, item.ability));
            if (!items.length) return null;
            return (
              <div className="app-nav-group" key={group.label}>
                <p className="app-nav-label">{group.label}</p>
                {items.map(item => (
                  <NavLink key={item.to} item={item} count={item.count && counts ? counts[item.count] : 0} />
                ))}
              </div>
            );
          })}
        </nav>
        <div className="app-sidebar-foot">
          {canOpenSettings(abilities) && <NavLink item={SETTINGS_ITEM} />}
          <a className="app-nav-link" href="/">
            <Icon name="arrow-left" size={18} />
            Back to the website
          </a>
        </div>
      </aside>
      <button type="button" className="app-scrim" aria-label="Close the menu" tabIndex={-1} onClick={() => setOpen(false)} />

      <div className="app-main">
        <header className="app-topbar">
          <IconButton
            className="app-menu-button"
            icon={open ? 'x' : 'menu'}
            label={open ? 'Close the menu' : 'Open the menu'}
            aria-expanded={open}
            onClick={() => setOpen(value => !value)}
          />
          <h1 className="app-title" ref={heading} tabIndex={-1}>
            {title}
          </h1>
          <div className="app-topbar-actions">
            <a className={`${buttonClass({variant: 'secondary', size: 'sm'})} app-view-store`} href="/" target="_blank" rel="noopener noreferrer">
              <Icon name="external" size={16} />
              <span className="app-view-store-label">View store</span>
              <span className="visually-hidden"> (opens in a new tab)</span>
            </a>
            <Menu
              label={`Theme: ${theme}`}
              trigger={<Icon name={theme === 'dark' ? 'moon' : theme === 'light' ? 'sun' : 'monitor'} size={18} />}
              items={[
                {label: 'Light', icon: 'sun', onSelect: () => setTheme('light')},
                {label: 'Dark', icon: 'moon', onSelect: () => setTheme('dark')},
                {label: 'Same as this device', icon: 'monitor', onSelect: () => setTheme('system')},
              ]}
            />
            {viewer && (
              <Menu
                label={`Account menu for ${viewer.name ?? 'you'}`}
                trigger={
                  <>
                    {signingOut ? <span className="spinner" aria-hidden="true" /> : <Avatar name={viewer.name ?? ''} size="sm" />}
                    <span className="app-viewer-name">{signingOut ? 'Signing out…' : viewer.name}</span>
                    <Icon name="chevron-down" size={16} />
                  </>
                }
                disabled={signingOut}
                items={[
                  {label: 'Your account', icon: 'user', onSelect: () => void navigate({to: '/account'})},
                  {label: 'Back to the website', icon: 'globe', onSelect: () => window.location.assign('/')},
                  'separator',
                  {
                    label: 'Sign out',
                    icon: 'log-out',
                    onSelect: () => {
                      setSigningOut(true);
                      void logout();
                    },
                  },
                ]}
              />
            )}
          </div>
        </header>
        <main className="app-content" id="main">
          {/* A new path fades in; search-only changes (filters, paging) stay still (VAREL RouteFade). */}
          <div key={pathname} className="app-route">
            <AccessGate pathname={pathname} abilities={abilities}>
              <Outlet />
            </AccessGate>
          </div>
        </main>
      </div>
    </div>
  );
}

// One `createRoute` per screen, with a LITERAL path (`<Link to>` is typed from
// them), a title, a loader over the screen's own queries, a lazy screen.

// ------------------------------------------------------------- overview --

const overviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  staticData: {title: 'Dashboard'},
  validateSearch: validateDashboardSearch,
  loaderDeps: ({search}) => search,
  loader: async ({context: {queryClient}, deps}) => {
    // The tiles the visitor may see, as the screen's `enabled` flags decide.
    const [me] = await Promise.all([
      queryClient.ensureQueryData(meQuery).catch(() => null),
      warm(queryClient.ensureQueryData(healthQuery), queryClient.ensureQueryData(twoFactorQuery), queryClient.ensureQueryData(siteQuery)),
    ]);
    const can = me?.abilities;
    await warm(
      ...(can?.manageUsers ? [queryClient.ensureQueryData(firstUsersQuery)] : []),
      ...(can?.readAudit ? [queryClient.ensureQueryData(firstAuditQuery)] : []),
      loadOverview(queryClient, deps)
    );
  },
  component: lazyRouteComponent(() => import('./screens/overview'), 'Overview'),
});
const analyticsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/analytics',
  staticData: {title: 'Analytics'},
  validateSearch: validateAnalyticsSearch,
  loaderDeps: ({search}) => search,
  loader: ({context: {queryClient}, deps}) => warm(loadAnalytics(queryClient, deps)),
  component: lazyRouteComponent(() => import('./screens/analytics'), 'Analytics'),
});

// ---------------------------------------------------------------- sales --

const ordersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/orders',
  staticData: {title: 'Orders'},
  validateSearch: validateOrdersSearch,
  loaderDeps: ({search}) => search,
  loader: ({context: {queryClient}, deps}) => warm(loadOrders(queryClient, deps)),
  component: lazyRouteComponent(() => import('./screens/orders'), 'OrdersList'),
});
const orderRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/orders/$number',
  staticData: {title: 'Order'},
  loader: ({context: {queryClient}, params}) => warm(loadOrder(queryClient, params.number)),
  component: lazyRouteComponent(() => import('./screens/orders'), 'OrderDetail'),
});
const returnsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/returns',
  staticData: {title: 'Returns'},
  validateSearch: validateReturnsSearch,
  loaderDeps: ({search}) => search,
  loader: ({context: {queryClient}, deps}) => warm(loadReturns(queryClient, deps)),
  component: lazyRouteComponent(() => import('./screens/returns'), 'ReturnsList'),
});
const returnRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/returns/$id',
  staticData: {title: 'Return'},
  loader: ({context: {queryClient}, params}) => warm(loadReturn(queryClient, params.id)),
  component: lazyRouteComponent(() => import('./screens/returns'), 'ReturnDetail'),
});
const abandonedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/abandoned',
  staticData: {title: 'Abandoned bags'},
  loader: ({context: {queryClient}}) => warm(loadAbandoned(queryClient)),
  component: lazyRouteComponent(() => import('./screens/abandoned'), 'AbandonedBags'),
});
const customersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/customers',
  staticData: {title: 'Customers'},
  validateSearch: validateCustomersSearch,
  loaderDeps: ({search}) => search,
  loader: ({context: {queryClient}, deps}) => warm(loadCustomers(queryClient, deps)),
  component: lazyRouteComponent(() => import('./screens/customers'), 'CustomersList'),
});
const customerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/customers/$id',
  staticData: {title: 'Customer'},
  loader: ({context: {queryClient}, params}) => warm(loadCustomer(queryClient, params.id)),
  component: lazyRouteComponent(() => import('./screens/customers'), 'CustomerDetail'),
});
const subscribersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/subscribers',
  staticData: {title: 'Subscribers'},
  validateSearch: validateSubscribersSearch,
  loaderDeps: ({search}) => search,
  loader: ({context: {queryClient}, deps}) => warm(loadSubscribers(queryClient, deps)),
  component: lazyRouteComponent(() => import('./screens/subscribers'), 'Subscribers'),
});

// -------------------------------------------------------------- catalog --

const productsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/products',
  staticData: {title: 'Products'},
  validateSearch: validateProductsSearch,
  loaderDeps: ({search}) => search,
  loader: ({context: {queryClient}, deps}) => warm(loadProducts(queryClient, deps)),
  component: lazyRouteComponent(() => import('./screens/products'), 'ProductsList'),
});
const newProductRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/products/new',
  staticData: {title: 'New product'},
  loader: ({context: {queryClient}}) => warm(loadNewProduct(queryClient)),
  component: lazyRouteComponent(() => import('./screens/products'), 'NewProduct'),
});
const productRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/products/$id',
  staticData: {title: 'Product'},
  loader: ({context: {queryClient}, params}) => warm(loadProduct(queryClient, params.id)),
  component: lazyRouteComponent(() => import('./screens/products'), 'EditProduct'),
});
const inventoryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/inventory',
  staticData: {title: 'Inventory'},
  validateSearch: validateInventorySearch,
  loaderDeps: ({search}) => search,
  loader: ({context: {queryClient}, deps}) => warm(loadInventory(queryClient, deps)),
  component: lazyRouteComponent(() => import('./screens/inventory'), 'Inventory'),
});
const catalogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/catalog',
  staticData: {title: 'Departments'},
  loader: ({context: {queryClient}}) => warm(loadDepartments(queryClient)),
  component: lazyRouteComponent(() => import('./screens/catalog'), 'Departments'),
});
const collectionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/collections',
  staticData: {title: 'Collections'},
  loader: ({context: {queryClient}}) => warm(loadCollections(queryClient)),
  component: lazyRouteComponent(() => import('./screens/collections'), 'CollectionsList'),
});
const categoryOrderRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/collections/category-order',
  staticData: {title: 'Category order'},
  loader: ({context: {queryClient}}) => warm(loadCategoryOrder(queryClient)),
  component: lazyRouteComponent(() => import('./screens/collections'), 'CategoryOrder'),
});
const collectionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/collections/$id',
  staticData: {title: 'Collection'},
  loader: ({context: {queryClient}, params}) => warm(loadCollection(queryClient, params.id)),
  component: lazyRouteComponent(() => import('./screens/collections'), 'CollectionEditor'),
});
const reviewsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reviews',
  staticData: {title: 'Reviews'},
  validateSearch: validateReviewsSearch,
  loaderDeps: ({search}) => search,
  loader: ({context: {queryClient}, deps}) => warm(loadReviews(queryClient, deps)),
  component: lazyRouteComponent(() => import('./screens/reviews'), 'Reviews'),
});

// ---------------------------------------------------------------- store --

const discountsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/discounts',
  staticData: {title: 'Discounts'},
  validateSearch: validateDiscountsSearch,
  loaderDeps: ({search}) => search,
  loader: ({context: {queryClient}, deps}) => warm(loadDiscounts(queryClient, deps)),
  component: lazyRouteComponent(() => import('./screens/discounts'), 'DiscountsPage'),
});
const newDiscountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/discounts/new',
  staticData: {title: 'New discount'},
  validateSearch: validateNewDiscountSearch,
  loaderDeps: ({search}) => search,
  loader: ({context: {queryClient}, deps}) => warm(loadNewDiscount(queryClient, deps)),
  component: lazyRouteComponent(() => import('./screens/discounts'), 'NewDiscount'),
});
const discountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/discounts/$id',
  staticData: {title: 'Discount'},
  validateSearch: validateDiscountEditSearch,
  loader: ({context: {queryClient}, params}) => warm(loadDiscount(queryClient, params.id)),
  component: lazyRouteComponent(() => import('./screens/discounts'), 'EditDiscount'),
});
const staffRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/staff',
  staticData: {title: 'Staff'},
  loader: ({context: {queryClient}}) => warm(loadStaff(queryClient)),
  component: lazyRouteComponent(() => import('./screens/staff'), 'StaffPage'),
});
const usersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/users',
  staticData: {title: 'Users'},
  loader: ({context: {queryClient}}) => warm(queryClient.ensureInfiniteQueryData(usersQuery({email: '', status: ''}))),
  component: lazyRouteComponent(() => import('./screens/users'), 'Users'),
});
const rolesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/roles',
  staticData: {title: 'Roles'},
  loader: ({context: {queryClient}}) => warm(queryClient.ensureQueryData(rolesQuery), queryClient.ensureQueryData(permissionsQuery)),
  component: lazyRouteComponent(() => import('./screens/roles'), 'Roles'),
});
const activityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/activity',
  staticData: {title: 'Activity'},
  validateSearch: validateActivitySearch,
  loaderDeps: ({search}) => search,
  loader: ({context: {queryClient}, deps}) => warm(queryClient.ensureInfiniteQueryData(auditQuery), loadActivity(queryClient, deps)),
  component: lazyRouteComponent(() => import('./screens/activity'), 'Activity'),
});

// -------------------------------------------------------------- content --

const journalRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/journal',
  staticData: {title: 'Journal'},
  validateSearch: validateJournalListSearch,
  loaderDeps: ({search}) => search,
  loader: ({context: {queryClient}, deps}) => warm(loadPosts(queryClient, deps)),
  component: lazyRouteComponent(() => import('./screens/journal'), 'JournalList'),
});
const newPostRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/journal/new',
  staticData: {title: 'New post'},
  loader: ({context: {queryClient}}) => warm(loadNewPost(queryClient)),
  component: lazyRouteComponent(() => import('./screens/journal'), 'NewPost'),
});
const postRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/journal/$slug',
  staticData: {title: 'Post'},
  loader: ({context: {queryClient}, params}) => warm(loadPost(queryClient, params.slug)),
  component: lazyRouteComponent(() => import('./screens/journal'), 'EditPost'),
});
const pagesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/pages',
  staticData: {title: 'Pages'},
  loader: ({context: {queryClient}}) => warm(loadPages(queryClient)),
  component: lazyRouteComponent(() => import('./screens/pages'), 'PagesList'),
});
const pageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/pages/$id',
  staticData: {title: 'Page'},
  loader: ({context: {queryClient}, params}) => warm(loadPage(queryClient, params.id)),
  component: lazyRouteComponent(() => import('./screens/pages'), 'PageEditor'),
});
const navigationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/navigation',
  staticData: {title: 'Navigation'},
  loader: ({context: {queryClient}}) => warm(loadNavigation(queryClient)),
  component: lazyRouteComponent(() => import('./screens/navigation'), 'Navigation'),
});

// ------------------------------------------------------------- settings --

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  staticData: {title: 'Settings'},
  component: lazyRouteComponent(() => import('./screens/settings'), 'SettingsLayout'),
});
// One literal route per section (a factory would widen `path` to `string` and untype `<Link to>`).
const settingsLoader =
  (section: SettingsSection) =>
  ({context: {queryClient}}: {context: {queryClient: QueryClient}}) =>
    warm(loadSettings(queryClient, section));
const generalSettingsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/',
  staticData: {title: 'Settings'},
  loader: settingsLoader('general'),
  component: lazyRouteComponent(() => import('./screens/settings'), 'GeneralSettings'),
});
const checkoutSettingsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/checkout',
  staticData: {title: 'Checkout'},
  loader: settingsLoader('checkout'),
  component: lazyRouteComponent(() => import('./screens/settings'), 'CheckoutSettings'),
});
const paymentsSettingsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/payments',
  staticData: {title: 'Payments'},
  loader: settingsLoader('payments'),
  component: lazyRouteComponent(() => import('./screens/settings'), 'PaymentsSettings'),
});
const taxSettingsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/tax',
  staticData: {title: 'Tax and currency'},
  loader: settingsLoader('tax'),
  component: lazyRouteComponent(() => import('./screens/settings'), 'TaxSettings'),
});
const shippingSettingsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/shipping',
  staticData: {title: 'Shipping'},
  loader: settingsLoader('shipping'),
  component: lazyRouteComponent(() => import('./screens/settings'), 'ShippingSettings'),
});
const inventorySettingsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/inventory',
  staticData: {title: 'Inventory and returns'},
  loader: settingsLoader('inventory'),
  component: lazyRouteComponent(() => import('./screens/settings'), 'InventorySettings'),
});
const privacySettingsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/privacy',
  staticData: {title: 'Customers and privacy'},
  loader: settingsLoader('privacy'),
  component: lazyRouteComponent(() => import('./screens/settings'), 'PrivacySettings'),
});
const seoSettingsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/seo',
  staticData: {title: 'SEO'},
  loader: settingsLoader('seo'),
  component: lazyRouteComponent(() => import('./screens/settings'), 'SeoSettings'),
});
const emailsSettingsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/emails',
  staticData: {title: 'Emails'},
  validateSearch: validateEmailsSearch,
  loaderDeps: ({search}) => search,
  loader: ({context: {queryClient}, deps}) => warm(loadEmails(queryClient, deps)),
  component: lazyRouteComponent(() => import('./screens/settings/emails'), 'Emails'),
});
const languagesSettingsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/languages',
  staticData: {title: 'Languages'},
  validateSearch: validateTranslationsSearch,
  loaderDeps: ({search}) => search,
  loader: ({context: {queryClient}, deps}) => warm(loadLanguages(queryClient, deps)),
  component: lazyRouteComponent(() => import('./screens/settings/languages'), 'Languages'),
});
// Moved: delivery settings are a tab of Settings · Emails.
const emailSettingsRedirect = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/email',
  beforeLoad: () => {
    throw redirect({to: '/settings/emails', search: {tab: 'delivery'}, replace: true});
  },
});

// VAREL's old admin addresses, moved under Settings (filters carry over).
const emailsRedirect = createRoute({
  getParentRoute: () => rootRoute,
  path: '/emails',
  validateSearch: validateEmailsSearch,
  beforeLoad: ({search}) => {
    throw redirect({to: '/settings/emails', search, replace: true});
  },
});
const shippingRedirect = createRoute({
  getParentRoute: () => rootRoute,
  path: '/shipping',
  beforeLoad: () => {
    throw redirect({to: '/settings/shipping', replace: true});
  },
});
const translationsRedirect = createRoute({
  getParentRoute: () => rootRoute,
  path: '/translations',
  validateSearch: validateTranslationsSearch,
  beforeLoad: ({search}) => {
    throw redirect({to: '/settings/languages', search, replace: true});
  },
});

// -------------------------------------------------------------- account --

const accountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/account',
  staticData: {title: 'Your account'},
  // `?tab=security`: a link can open one section of the account screen.
  validateSearch: (search: Record<string, unknown>): {tab?: string} => (typeof search.tab === 'string' ? {tab: search.tab} : {}),
  loader: ({context: {queryClient}}) =>
    warm(queryClient.ensureQueryData(meQuery), queryClient.ensureQueryData(twoFactorQuery), queryClient.ensureQueryData(sessionsQuery)),
  component: lazyRouteComponent(() => import('./screens/account'), 'Account'),
});

// The UI kit on screen, for the owner and their agent. Dev only: the whole route (and its
// chunk) is left out of a build, because `import.meta.env.DEV` is `false` there.
const devRoutes = import.meta.env.DEV
  ? [
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/components',
        staticData: {title: 'Components'},
        component: lazyRouteComponent(() => import('./screens/components'), 'Components'),
      }),
    ]
  : [];

export const routeTree = rootRoute.addChildren([
  overviewRoute,
  analyticsRoute,
  ordersRoute,
  orderRoute,
  returnsRoute,
  returnRoute,
  abandonedRoute,
  customersRoute,
  customerRoute,
  subscribersRoute,
  productsRoute,
  newProductRoute,
  productRoute,
  inventoryRoute,
  catalogRoute,
  collectionsRoute,
  categoryOrderRoute,
  collectionRoute,
  reviewsRoute,
  discountsRoute,
  newDiscountRoute,
  discountRoute,
  staffRoute,
  usersRoute,
  rolesRoute,
  activityRoute,
  journalRoute,
  newPostRoute,
  postRoute,
  pagesRoute,
  pageRoute,
  navigationRoute,
  settingsRoute.addChildren([
    generalSettingsRoute,
    checkoutSettingsRoute,
    paymentsSettingsRoute,
    taxSettingsRoute,
    shippingSettingsRoute,
    inventorySettingsRoute,
    emailsSettingsRoute,
    languagesSettingsRoute,
    privacySettingsRoute,
    seoSettingsRoute,
    emailSettingsRedirect,
  ]),
  emailsRedirect,
  shippingRedirect,
  translationsRedirect,
  accountRoute,
  ...devRoutes,
]);
