# VAREL → Astro app: parallel migration plan

**Goal:** full feature parity of VAREL (`C:\Users\Appifylab\Projects\VAREL`, ~86k lines) on this
Astro template (`site-astro-app` 0.10.6), following `AGENTS.md` and `docs/agent/*.md` except
where a decision below says otherwise. Built by ~31 agents in 3 waves.

- **Source:** `C:\Users\Appifylab\Projects\VAREL` (read-only for every agent; never edit it).
- **Target:** `C:\Users\Appifylab\Projects\varel-astro`, branch `main`.
- **Read first, every agent:** this file (whole), `AGENTS.md`, then the `docs/agent/*.md`
  topics the package touches. VAREL's `FRONTEND.md`, `docs/API.md`, `docs/ADMIN_API.md` and
  `docs/PHASE2-3.md` describe the behaviour to reproduce.

---

## 1. Decisions (defaults in force; the owner may override)

| # | Decision | Default in this plan | Why |
|---|---|---|---|
| D1 | Storefront UI | **Tailwind v4 + React islands** (owner's choice). VAREL's `components/varel` + needed `components/ui` (shadcn/Radix) ported to `src/components/`. Tailwind is imported ONLY by `src/styles/storefront.css`, never by the dashboard. | Fastest faithful port of the VAREL design. Verified: compiles to a linked `/_astro/*.css`, so the CSP holds. |
| D2 | Admin UI | **`/dashboard` built on the template's portal UI kit** (`src/portal/ui`), rebranded with VAREL tokens. VAREL's admin screens keep their logic, data flow and layout, but swap components via the mapping in §6. Missing pieces (rich-text editor, date-range filter, translation editor, sales chart) are ADDED to `src/portal/ui/`. | `AGENTS.md`: one UI kit in the dashboard; template Users/Roles/Activity screens stay consistent. |
| D3 | Payments | **Own provider, as VAREL did:** `simulated` (default, dev) + **Stripe** with server-computed PaymentIntents via `config.ownerSecret('STRIPE_SECRET_KEY')`, webhook route verified with `ownerSecret('STRIPE_WEBHOOK_SECRET')`, Stripe Payment Element only on `/checkout/` (CSP opened on that page only via `allowEmbeddedCheckout`-style per-page CSP). The template's one-price BuyButton flow is NOT used. | Built-in payments charge one fixed price key × qty: no cart, variants, discounts, shipping or tax. |
| D4 | Shop orders table | Models `ShopOrder`/`ShopOrderItem`/`ShopOrderEvent`/`ShopPayment` → tables `shop_orders`, … | `Order`/`orders` and `memberships` are managed by the template. |
| D5 | Accounts | Template auth only (users, roles, sign-in pages under `/account/*`). VAREL `User.role` customer/staff/admin → template roles `member` / `staff` (new) / `admin`. VAREL `Session`, `PasswordResetToken`, `StaffInvite` are dropped; staff are invited from the template's Users screen. Profile fields (first/last name, phone, locale, marketing opt-in) → `CustomerProfile` keyed by `userId`. Guest identity (cart, wishlist) → our own `visitor_id` cookie set by a storefront route (not an auth cookie). | `AGENTS.md`: never write auth. |
| D6 | Customer account area | A React app at **`/account/*`** (catch-all `src/pages/account/[...path].astro`; the template's static sign-in pages keep precedence), storefront look (D1), TanStack Router with `basepath: '/account'`. URLs as in VAREL: `/account/`, `/account/orders/`, `/account/addresses/`, … | Keeps VAREL URLs; signed-in + interactive = SPA per `AGENTS.md`. |
| D7 | Locales | en (default, no prefix) + `/da/ /de/ /fr/ /es/ /sv/` path prefixes, rewritten by `src/middleware.ts` (`context.rewrite`) so page files stay locale-agnostic. Strings: VAREL `src/locales/<loc>/<ns>.json` copied as-is; a small `t()` (`src/lib/i18n`) replaces i18next on server and in islands (islands receive their namespace dictionary as a prop). Content translations: VAREL `Translation` table. hreflang in `<Base>`. | No i18n in the template; prefixes are crawlable and cacheable. |
| D8 | Media & downloads | Platform files (`src/platform/files.ts`): product/journal images `visibility:'public'` (pre-sized on upload in the browser), digital downloads private + guarded 302 to `fileUrl`. Seed images stay as https URLs. | No R2. Needs the owner's storage pack on live. |
| D9 | Email | VAREL's email engine ported as-is (templates table, render, outbox default). Providers Resend/Postmark/webhook via `config.ownerSecret`; sent from background jobs. Account emails stay the platform's. | Platform relays only account emails. |
| D10 | Scheduled work | `background.json` schedules + `sendJob`: `abandoned-carts` (every 15 min via cron), `pending-payments` (every 15 min), `translations-backfill` (hourly). | No cron triggers. |
| D11 | Analytics | First-party `POST /site-api/events` beacon (consent-gated), aggregated in the admin. | `connect-src 'self'`. |
| D12 | Template demo | Job board (`/jobs`, job routes, jobs screen) and Markdown blog removed in Wave 0 (`/blog/*` → 301 `/journal/`). The `Job` model stays (removing it needs a destructive migration; do it later). | Not part of VAREL. |
| D13 | URLs | VAREL paths with a trailing slash: `/shop/`, `/shop/<dept>/<cat>/`, `/product/<slug>/`, `/collections/<slug>/`, `/journal/<slug>/`, `/journal/category/<c>/`, `/search/`, `/cart/`, `/checkout/`, `/order/<n>/confirmation/`, `/wishlist/`, `/returns/`, `/pages/<slug>/`, `/about/`, `/contact/`, `/privacy/`, `/terms/`. Sign-in: template `/account/login/`, `/account/register/` (VAREL `/login`, `/signup`, `/reset-password` → 301). Admin: `/dashboard/*` (VAREL `/admin/*` → 301 `/dashboard/*`). | Template rule: trailing slash; sign-in under `/account/`. |

---

## 2. Architecture mapping (VAREL → target)

| VAREL | Target |
|---|---|
| `worker/index.ts` Hono app, `/api/*` | `src/server/app.ts`, `/site-api/*` (chained `.route()` registry, built in Wave 0) |
| `worker/routes/<x>.ts` | `src/server/routes/<x>.ts` |
| `worker/routes/admin/<x>.ts` (`/api/admin/x`) | `src/server/routes/admin/<x>.ts` mounted at `/site-api/manage/<x>` behind `requirePermission` |
| `worker/lib/**` | `src/server/lib/**` (same file names) |
| `worker/jobs/*`, `lib/scheduled.ts` | `src/server/jobs/<list>.ts` + `src/server/background.ts` + `background.json` |
| `worker/middleware/auth,session,permissions` | template guards (`withViewer → requireAuth → requirePermission → withDb`) + `src/server/lib/visitor.ts` (guest id) |
| `worker/middleware/locale` | `src/middleware.ts` locale resolution → `Astro.locals.locale`; `X-Locale` forwarded to the in-process API |
| `worker/middleware/validate` (zod) | `hono/validator` wrapping zod schemas (`src/server/lib/validate.ts`, Wave 0) |
| `worker/routes/html.ts` (SEO injection) | real Astro SSR pages + `<Base>` SEO props + `src/lib/seo.ts` (`productJsonLd`, `articleJsonLd`) |
| `worker/types.ts`, `admin-types.ts` / `src/lib/api/types.ts`, `src/lib/admin/types.ts` | `src/lib/types/<area>.ts` (one contract, imported by server and client) |
| `src/pages/<Page>.tsx` (SPA pages) | `src/pages/<route>/*.astro` (SSR) + islands in `src/components/<area>/*.tsx` (`client:visible` / `client:load`) |
| `src/lib/api/hooks.ts` (TanStack Query) | SSR: `pageContext().api` in-process; islands: `siteFetch` (`src/platform/browser.ts`) via `src/lib/storefront-api.ts` |
| `src/pages/admin/**` | `src/portal/screens/<area>/*.tsx` |
| `src/lib/admin/*.ts` | `src/portal/queries/<area>.ts` (+ mutations in the screen or `src/portal/mutations/<area>.ts`) |
| `components/layout` (SiteLayout etc.) | `src/layouts/Storefront.astro`, `AuthShell.astro`, `CheckoutShell.astro` + `src/components/layout/*` |
| Google Fonts link | self-hosted woff2 in `public/fonts/` (Cormorant Garamond 500, Lato 400/700) |
| R2 `MEDIA` / `DOWNLOADS` | platform files (D8) |
| `scripts/seed-r2.sh`, `prisma/seed.ts` | `prisma/seed.sql` generated by `scripts/gen-seed.ts` from VAREL seed data |
| `tests/*.test.ts` (node:test) | `tests/*.test.ts` (vitest) |

---

## 3. Ground rules for every agent (NON-NEGOTIABLE)

1. **Own only your files.** Each package lists the paths it owns. Never edit a file another
   package owns; if you need a change there, write it under "Requests" in your hand-off note.
   Shared registries (`src/server/app.ts`, `src/portal/routes.tsx`, `src/server/permissions.ts`,
   `src/server/background.ts`, `background.json`, `src/pages/sitemap.xml.ts`,
   `prisma/schema.prisma`, `package.json`) are written in Wave 0 with every slot pre-wired;
   Wave 1 fills the files the slots point at.
2. **No dependency changes.** Everything is installed. Need a package → Request.
3. **No schema changes in Wave 1** unless additive and unavoidable: then a new migration
   `prisma/migrations/<YYYYMMDDHHMMSS>_<wp-id>_<name>/` (BEGIN/COMMIT), schema edits only
   inside your own models, and a Request so the integrator checks ordering.
4. **Isolation:** your own git worktree and branch `wp/<id>`, your own database
   `varel_<id>` (see §8), your own dev server port `44<NN>` (`npm run dev -- --port 44NN`).
   Kill your dev server when done. One heavy command (install/build/test) at a time.
5. **Template rules hold:** guards in order, validators on every input, explicit `select`,
   keyset paging, ≤100 rows, no `count()` per request, `sanitizeHtml` before `set:html`, no
   inline `style=""`/handlers in `.astro`, `siteFetch` not `fetch` in the browser, buttons and
   forms per `AGENTS.md` (pending states, `noValidate`, field errors), never edit
   `src/platform/**` or `docs/agent/**`.
6. **Parity first:** reproduce VAREL's behaviour, copy, layout and states (loading, empty,
   error). Port code, don't reinvent it: copy the VAREL file, then adapt imports, data access
   and routing. Keep VAREL's locale keys.
7. **Done means:** `npx astro check` clean for your files, `npm test` passes (add tests for
   your routes; integration tests against your DB with `TEST_DATABASE_URL`), the pages and
   screens render in your dev server with the seed data, and a hand-off note
   `docs/migration/handoff/<id>.md` (what was ported, what differs from VAREL, Requests,
   known gaps). Commit on `wp/<id>` with the attribution trailer.

---

## 4. Waves and dependencies

```
Wave 0 (5 agents, parallel, disjoint files) ── merge F1→F2→F3→F4→F5 ── smoke test ──┐
                                                                                    │
Wave 1 (26 agents, parallel; each needs only Wave 0) ───────── merge in any order ──┤
                                                                                    │
Wave 2 (3 agents, parallel) ── integration, SEO/perf, security, parity QA ──────────┘
```

Wave 0 is the critical path: it produces every contract Wave 1 relies on (schema, types,
route/screen/job slots, permissions, shared libraries, design system, layouts). Wave 1
packages never wait on each other; where one calls another's code, Wave 0 has already written
the function signature as a working stub (marked `// WP-<id> implements`), and the owning
package replaces the body without changing the signature.

---

## 5. Work packages

Legend: **Owns** = files only this package writes. **Source** = VAREL files to port.

### Wave 0 — Foundation

#### F1 · Schema, migrations, seed
- **Owns:** `prisma/schema.prisma`, `prisma/migrations/2026110*`, `prisma/seed.sql`,
  `scripts/gen-seed.ts`, `tests/integration/support/harness.ts` (TRUNCATE list).
- **Source:** `prisma/schema.prisma` (38 models, 13 enums), `prisma/seed.ts`, `prisma/data.ts`,
  `prisma/seed-phase23/**`.
- **Do:** port every VAREL model except `User`, `Session`, `PasswordResetToken`, `StaffInvite`
  (D5) with template conventions (`@@map` snake_case, `Int` autoincrement ids where VAREL used
  cuid only if no external reference depends on the format; keep string ids where URLs or
  cookies carry them; money in `Int` cents + `currency Char(3)`; enums → `VarChar` + CHECK;
  `Timestamptz(3)`; explicit `onDelete`; an index per query shape found in VAREL routes).
  Renames per D4. Add `CustomerProfile` (userId unique, firstName, lastName, phone, locale,
  marketingOptIn, …) and `Visitor` (id, createdAt, lastSeenAt) replacing `Session` as owner of
  guest carts/wishlists. User references → `userId Int` to the template `users` table
  (`onDelete: SetNull` for orders/reviews/activity, `Cascade` for profile/addresses/wishlist).
  `pg_trgm` extension + GIN trigram indexes for product/post search. A migration inserting
  role `staff` and VAREL area permissions mapping (codenames from F3's catalogue: coordinate
  via the table in §7). Seed: generate idempotent SQL from VAREL's seed (11 products, 120
  variants, taxonomy, posts, collections, pages, menus, discounts+codes, shipping zones,
  tax rates, settings, email templates, reviews, 30 days analytics, all translations, sample
  orders) — no users (orders/reviews keep `userId NULL`, guest email `@example.com`).
- **Done:** `prisma migrate deploy` + `prisma db execute --file prisma/seed.sql` on an empty DB,
  twice (idempotent); `prisma generate` ok; row counts in the hand-off note.

#### F2 · Storefront design system and shell
- **Owns:** `src/styles/storefront.css`, `public/fonts/**`, `public/images/**`,
  `src/components/varel/**`, `src/components/ui/**`, `src/components/layout/**`,
  `src/layouts/Storefront.astro`, `src/layouts/AuthShell.astro`,
  `src/layouts/CheckoutShell.astro`, `src/lib/stores/**` (bag/ui stores shared by islands),
  `src/lib/utils.ts` (`cn`), `src/layouts/Base.astro` (add `chrome` slot/prop + hreflang +
  locale `lang`; keep all SEO behaviour), `src/pages/styleguide.astro` (dev-only showcase).
- **Source:** `src/index.css`, `src/styles/tokens.css`, `src/components/varel/*`,
  `src/components/ui/*` (only those the storefront uses), `src/components/layout/*`,
  `index.html` (fonts, meta), `public/*`.
- **Do:** Tailwind `@theme` with VAREL tokens; self-hosted fonts (OFL; download woff2,
  `font-display: swap`, preload the display face). Port every varel component as React
  (no `style={}` in SSR output: replace with classes or `element.style` in effects). Layout:
  announcement bar, header (menus from `GET /site-api/menus`, counts from bag store), footer
  (newsletter form island), mobile menu, bag drawer **frame** (content island is WP-09's slot),
  cookie banner + consent store, language switcher, skip link, navigation progress.
  Bag/wishlist count + drawer open state shared across islands via a tiny store
  (`src/lib/stores/bag.ts`: subscribe/set, `CustomEvent` + `sessionStorage`), no new library.
- **Done:** `/styleguide/` shows every component; a page using `Storefront.astro` matches
  VAREL's header/footer at 375px and 1440px; no CSP violations in the console.

#### F3 · Backend contracts and registries
- **Owns:** `src/server/app.ts`, `src/server/routes/**` (creates every file below as a
  compiling stub), `src/server/permissions.ts`, `src/server/background.ts`,
  `src/server/jobs/**` (stubs), `background.json`, `src/lib/types/**`,
  `src/server/lib/validate.ts`, `src/server/lib/http.ts` (error helpers, keyset cursor helper),
  `src/server/lib/contracts.ts` (cross-package stubs, see below), `src/pages/sitemap.xml.ts`,
  `src/pages/robots.txt.ts`, `src/pages/rss.xml.ts`, removal of the job board + Markdown blog
  (D12), `astro.config.mjs` redirects (D13).
- **Source:** `worker/index.ts`, `worker/types.ts`, `worker/admin-types.ts`,
  `src/lib/api/types.ts`, `src/lib/admin/types.ts`, `worker/middleware/permissions.ts`,
  `worker/middleware/validate.ts`, `docs/API.md`, `docs/ADMIN_API.md`.
- **Do:** route modules (public): `settings, menus, catalog, product, collections, search, posts, pages,
  cart, wishlist, shipping, checkout, orders, returns, account, i18n, downloads, reviews,
  events, newsletter, contact, media`; webhooks app `payments-webhooks` mounted BEFORE
  `sameOrigin`/`csrf`; admin modules under `/manage`: `dashboard, analytics, products,
  inventory, taxonomy, collections, orders, returns, customers, subscribers, abandoned,
  discounts, posts, pages, menus, reviews, settings, tax-rates, shipping, payments, emails,
  translations, staff, activity, uploads`. Each stub exports a chained `new Hono()` returning
  501 so types compile. Types split per area from VAREL's contract files. Permissions: one
  `CATALOGUE` entry per VAREL admin area (§7). Background lists/schedules (D10) with stub
  handlers. Sitemap pulls `/site-api/<area>/sitemap` for products, collections, posts,
  pages (each returns `[]` until its package fills it). `contracts.ts` stubs:
  `sendTemplate(db, key, to, vars, opts)` (records to outbox — WP-22),
  `refundOrder(db, order, amountCents, reason)` (WP-11), `restockOrder(db, orderId)` (WP-11),
  `recordActivity(db, actor, action, target, meta)` (WP-26), `localize(rows, entity, locale)`
  (WP-25 extends; F4 provides the working base), `trackEvent` (WP-16).
- **Done:** `npm run build` ok; every route answers 501 with the error shape; `/dashboard`
  shows all nav items gated by abilities.

#### F4 · Shared domain libraries and i18n base
- **Owns:** `src/server/lib/**` except `validate.ts`, `http.ts`, `contracts.ts`;
  `src/lib/i18n/**`, `src/locales/**`, `src/lib/format.ts` (merge with template's),
  `src/lib/product.ts`, `src/lib/links.ts`, `src/lib/storefront-api.ts`,
  `src/middleware.ts` (locale prefix rewrite + resolution; keep template behaviour),
  `src/server/lib/visitor.ts`, `tests/promotions*.test.ts`, `tests/totals*.test.ts`,
  `tests/money*.test.ts`, `tests/i18n*.test.ts`, `tests/product-variants.test.ts`,
  `tests/rich-text.test.ts`.
- **Source:** `worker/lib/{money,totals,discounts,promotions-*,cart,catalog,collections,orders,
  settings,shipping,address-formats,checkout-rules,rich-text,serializers,format,activity,
  privacy,abandoned}.ts`, `worker/lib/i18n/{localize,structured,messages,sources}.ts`,
  `worker/locales/*`, `src/lib/{format,product,links,i18n/*,rich-text,search-params}.ts`,
  `src/locales/**`, `tests/*`.
- **Do:** port the libraries to the new schema names and template `getDb()`/`c.var.db`
  (no Session; visitor id). Discount/promotions engine, totals and money unchanged in
  behaviour: port VAREL's tests to vitest and make them pass. `t(locale, ns, key, vars)` +
  `useT(dict)` for islands; locale middleware per D7; `Astro.locals.locale`.
- **Done:** all ported unit tests pass; `/da/` rewrites to `/` with `locale='da'`.

#### F5 · Dashboard rebrand, kit extensions, screen registry
- **Owns:** `src/portal/routes.tsx`, `src/portal/PortalApp.tsx`, `src/portal/api.ts`,
  `src/portal/queries.ts` (keeps template queries; re-exports `src/portal/queries/*`),
  `src/portal/queries/<area>.ts` and `src/portal/screens/<area>/index.tsx` as stubs for every
  admin area, `src/portal/ui/**`, `src/styles/global.css` (tokens: VAREL palette + fonts,
  light/dark), `src/styles/app.css`, `src/layouts/App.astro`.
- **Source:** `src/components/admin/*`, `src/pages/admin/*/` (for the needed widgets),
  `src/components/admin/nav.ts`.
- **Do:** NAV_GROUPS mirroring VAREL's admin nav (Overview, Orders, Returns, Abandoned,
  Products, Inventory, Catalog, Collections, Customers, Subscribers, Discounts, Journal,
  Pages, Navigation, Reviews, Analytics, Settings, Staff, Activity) with abilities; a route per
  VAREL admin route (`/dashboard/products/$id`, …) pointing at lazy stub screens. Add to the
  kit: `RichTextEditor` (Tiptap, from VAREL), `DateRangeFilter`, `PeriodToggle`,
  `TranslationEditor` shell, `LineChart`/sales chart (SVG), `ImageUploader` (platform files),
  `SortableList` (drag order), `MoneyInput`, `TagInput`. Show each on `/dashboard/components`.
- **Done:** every admin nav item opens its stub screen; kit additions on the components screen.

**Wave 0 merge:** integrator merges F1→F2→F3→F4→F5 into `main`, runs build + tests +
migrate/seed on a fresh DB, tags `wave0`. Wave 1 branches from `wave0`.

### Wave 1 — Feature slices (all parallel)

Each slice owns its route file(s), pages, islands (`src/components/<area>/`), portal screen
folder, portal query file, its locale namespaces' JSON (all 6 locales) and its tests. When a
slice "owns" a route file it also fills its `/sitemap` sub-route if listed.

| ID | Package | Owns (server · pages · islands · portal) | Source (VAREL) |
|---|---|---|---|
| WP-01 | **Home** | `routes/settings.ts`, `routes/menus.ts` (public reads) · `src/pages/index.astro` · `components/home/**` | `pages/Home.tsx`, `pages/home/*`, `routes/misc.ts`, `routes/pages.ts` (menus) |
| WP-02 | **Catalog listing** | `routes/catalog.ts` (taxonomy, products list) · `pages/shop/**` · `components/catalog/**` | `pages/Shop,Category`, `pages/catalog/*`, `routes/catalog.ts`, `lib/catalog.ts` |
| WP-03 | **Product detail** | `routes/product.ts` (`/products/:slug`, related, sitemap) · `pages/product/[slug].astro` · `components/product/**` (gallery, buy column, size guide, related) | `pages/Product.tsx`, `pages/product/*` (except Reviews) |
| WP-04 | **Reviews** | `routes/reviews.ts`, `routes/admin/reviews.ts` · `components/reviews/**` · `portal/screens/reviews` | `product/Reviews.tsx`, `routes/reviews.ts`, `admin/reviews/*` |
| WP-05 | **Collections** | `routes/collections.ts`, `routes/admin/collections.ts` · `pages/collections/**` · `components/collections/**` · `portal/screens/collections` | `pages/Collections,Collection`, `admin/collections/*` |
| WP-06 | **Journal** | `routes/posts.ts`, `routes/admin/posts.ts` · `pages/journal/**` · `components/journal/**` · `portal/screens/journal` · RSS feed body | `pages/Blog*,BlogPost`, `pages/journal/*`, `admin/journal/*` |
| WP-07 | **CMS pages & navigation** | `routes/pages.ts`, `routes/contact.ts`, `routes/admin/{pages,menus}.ts` · `pages/{about,contact,privacy,terms}.astro`, `pages/pages/[slug].astro`, `404.astro`, `500.astro` · `portal/screens/{pages,navigation}` (incl. home hero editor) | `pages/{About,Contact,Privacy,Terms,CmsPage,NotFound}`, `policy/*`, `admin/{pages,navigation}/*` |
| WP-08 | **Search** | `routes/search.ts` · `pages/search/index.astro` · `components/search/**` | `pages/Search.tsx`, `routes/search.ts` |
| WP-09 | **Cart & bag** | `routes/cart.ts` (incl. discount apply, totals, `/cart/email`, `/cart/recover/:token`) · `pages/cart/index.astro` · `components/cart/**` (bag drawer content, add-to-bag action used by product/wishlist/home) | `pages/Cart.tsx`, `layout/BagDrawer.tsx`, `routes/{cart,abandoned}.ts` (public part) |
| WP-10 | **Wishlist** | `routes/wishlist.ts` · `pages/wishlist/index.astro` · `components/wishlist/**` (heart button) | `pages/Wishlist.tsx`, `routes/wishlist.ts` |
| WP-11 | **Checkout backend & payments** | `routes/checkout.ts`, `routes/payments-webhooks.ts`, `routes/shipping.ts` (public), `server/lib/payments/**`, `jobs/pending-payments.ts`, implements `refundOrder`/`restockOrder` | `routes/{checkout,webhooks,shipping}.ts`, `lib/payments/*`, `jobs/pending-payments.ts` |
| WP-12 | **Checkout UI & confirmation** | `pages/checkout/index.astro` (replaces template's), `pages/order/[number]/confirmation.astro`, `components/checkout/**`; removes `pages/thanks/` | `pages/Checkout.tsx`, `pages/checkout/*`, `pages/OrderConfirmation.tsx` |
| WP-13 | **Customer account app** | `routes/account.ts`, `routes/downloads.ts` · `pages/account/[...path].astro` · `src/account/**` (router, shell, overview, details, addresses, privacy, downloads) | `pages/account/*` (minus orders), `routes/{account,downloads}.ts` |
| WP-14 | **Orders & returns (customer)** | `routes/orders.ts`, `routes/returns.ts` · `src/account/screens/orders/**` · `pages/returns/index.astro` · `components/returns/**` | `pages/account/{OrderHistory,OrderDetails,Invoice,...}`, `pages/Returns.tsx`, `policy/ReturnRequest`, `routes/orders.ts` |
| WP-15 | **Sign-in pages & onboarding** | `src/pages/account/{login,register,forgot,reset,verify,confirm-email}.astro` (restyle only, logic untouched) · `src/server/auth-settings.ts` · `routes/i18n.ts` (`PATCH /account/locale`) · signup → `CustomerProfile` + newsletter opt-in | `pages/{Login,Signup,ResetPassword}.tsx`, `pages/auth/*`, `layout/AuthLayout.tsx` |
| WP-16 | **Overview & analytics** | `routes/events.ts`, `routes/admin/{dashboard,analytics}.ts` · `portal/screens/{overview,analytics}` · consent-gated beacon in `components/layout/analytics.ts` hook-up | `admin/dashboard/*`, `admin/analytics/*`, `routes/events.ts`, `lib/analytics.ts` |
| WP-17 | **Products admin** | `routes/admin/{products,uploads}.ts` · `portal/screens/products` (list, editor, sections, media via platform files, duplicate) | `admin/products/*` (except VariantsSection), `routes/admin/products.ts` |
| WP-18 | **Variants, inventory, taxonomy** | `routes/admin/{inventory,taxonomy}.ts` · `portal/screens/{inventory,catalog}` · `portal/screens/products/VariantsSection.tsx` (slot left by WP-17) | `admin/products/VariantsSection.tsx`, `admin/inventory/*`, `admin/catalog/*` |
| WP-19 | **Orders & returns admin** | `routes/admin/{orders,returns}.ts` · `portal/screens/{orders,returns}` (detail, refund, CSV) | `admin/orders/*`, `admin/returns/*` |
| WP-20 | **Customers & subscribers** | `routes/admin/{customers,subscribers}.ts`, `routes/newsletter.ts` · `portal/screens/{customers,subscribers}` | `admin/customers/*`, `admin/subscribers/*`, `routes/misc.ts` (newsletter) |
| WP-21 | **Discounts admin** | `routes/admin/discounts.ts` (+ codes, report, preview) · `portal/screens/discounts` | `admin/discounts/*`, `routes/admin/discount*.ts` |
| WP-22 | **Emails** | `server/lib/email/**`, implements `sendTemplate`, `jobs/send-email.ts`, `routes/admin/emails.ts` · `portal/screens/settings/emails` | `lib/email/*`, `routes/admin/emails.ts`, `admin/settings/emails/*` |
| WP-23 | **Store settings** | `routes/admin/{settings,tax-rates,shipping,payments}.ts` · `portal/screens/settings/**` except `emails`, `languages` | `admin/settings/*`, `routes/admin/{settings,tax-rates,shipping,payments}.ts` |
| WP-24 | **Abandoned carts** | `routes/admin/abandoned.ts`, `jobs/abandoned-carts.ts` · `portal/screens/abandoned` | `admin/abandoned/*`, `routes/admin/abandoned.ts`, `jobs/abandoned-carts.ts`, `lib/abandoned.ts` |
| WP-25 | **Translations & languages** | `server/lib/i18n/{translate,status,backfill,providers}/**`, `routes/admin/translations.ts`, `jobs/translations-backfill.ts` · `portal/screens/settings/languages`, `portal/ui/TranslationEditor` body · hreflang + sitemap alternates | `lib/i18n/*`, `admin/translations/*`, `jobs/translations.ts` |
| WP-26 | **Staff, roles & activity** | `routes/admin/{staff,activity}.ts`, implements `recordActivity` · `portal/screens/{staff,activity}` (on top of template Users/Roles/Activity; VAREL area permissions as role permissions) | `admin/staff/*`, `routes/admin/{staff,activity}.ts`, `lib/activity.ts` |

### Wave 2 — Integration and hardening

| ID | Package | Scope |
|---|---|---|
| I1 | **SEO & performance** | sitemap (all areas + alternates), robots, RSS, JSON-LD, canonical/hreflang; page JS budgets (<50 KB public), image sizes, cache headers on public SSR reads, Lighthouse ≥95 on home/shop/product/journal. |
| I2 | **Security & tests** | `docs/agent/security.md` checklist over every route; integration test per guarded route; rate limits on reviews/newsletter/contact/events/returns lookup; webhook signature tests; CSP clean on every page. |
| I3 | **Parity QA** | Side by side with VAREL (`http://localhost:5180`): every storefront page at 375/1440, every admin screen; end-to-end flows (browse → bag → discount → checkout simulated + Stripe test → confirmation email in outbox → admin fulfil → refund; returns; abandoned-cart reminder; translations). File fixes as Requests to the owning package or fix directly after Wave 1 is merged. |

---

## 6. VAREL admin kit → template portal kit

| VAREL (`components/admin`, `components/ui`) | Template (`src/portal/ui`) |
|---|---|
| `AdminPage`/page header | `PageHeader` |
| `Panel`, `card` | `Card` (+ `SettingRow` on settings) |
| `KpiTile`, stat cards | `Stat` (+ `Sparkline`) |
| `table`, list rows | `DataTable` + `LoadMore` (keyset) |
| `StatusChip`, `badge` | `StatusBadge` / `Badge` with one `STATUS_TONES` map per screen |
| `dropdown-menu` row actions | `Menu` + `MenuItem` |
| `dialog`, `ConfirmDialog` | `Modal`, `useConfirm` |
| `sheet` edit panes | `Drawer` |
| `sonner` toasts | `useToast` |
| `toggle-group`, `PeriodToggle` | `SegmentedControl` / `PeriodToggle` (F5) |
| `switch`, `checkbox`, `select`, inputs | `Switch`, `Checkbox`, `Select`, `Field` + `useForm` |
| `RichTextEditor` | `RichTextEditor` (F5) |
| `DateRangeFilter`, `calendar` | `DateRangeFilter` (F5) |
| `SalesChart` | `LineChart` / `BarChart` |
| `admin/icons`, lucide | `Icon` (add lucide paths to `ui/icon.tsx`) |
| `Skeleton`, empty states | `Skeleton`, `LoadingBlock`, `EmptyState`, `ErrorNote` |

Screens keep VAREL's sections, fields, copy and behaviour; only the components change.

## 7. Permissions (F3 writes; F1's role migration uses the same codenames)

| VAREL area | Codename | Ability | Default roles |
|---|---|---|---|
| orders | `site:shop_order:manage` | `manageOrders` | admin, staff |
| customers | `site:customer:manage` | `manageCustomers` | admin, staff |
| products | `site:product:manage` | `manageProducts` | admin, staff |
| content | `site:content:manage` | `manageContent` | admin, staff |
| discounts | `site:discount:manage` | `manageDiscounts` | admin, staff |
| analytics | `site:analytics:read` | `viewAnalytics` | admin, staff |
| settings | `site:store_settings:manage` | `manageStoreSettings` | admin |
| staff | `site:user:*` (template core) | `manageUsers` | admin |

Owner has `*`. Customers are `member` (no admin abilities). Per-staff area restriction =
custom roles in the template's Roles screen.

## 8. Running it

**Integrator setup (once, done):** repo, Docker Postgres `varel-astro-db` on `127.0.0.1:5436`
(user/pass `varel`), test DB `varel-astro-test-db` on `127.0.0.1:5437` (pass `dev`), `.env`
from `.env.example`, all dependencies installed.

**Per agent:**
```bash
git worktree add ../varel-astro-wt/<id> -b wp/<id> wave0      # (F1–F5: from main)
cd ../varel-astro-wt/<id> && npm ci
cp ../../varel-astro/.env .env
docker exec varel-astro-db createdb -U varel varel_<id>        # own database
# in .env: DATABASE_URL=postgresql://varel:varel@localhost:5436/varel_<id>
npx prisma migrate deploy && npx prisma db execute --file prisma/seed.sql
npm run dev -- --port 44<NN>                                   # NN = package number
```
Integration tests: `docker exec varel-astro-test-db createdb -U postgres t_<id>` and
`TEST_DATABASE_URL=postgresql://postgres:dev@localhost:5437/t_<id>`.

Machine: 12 cores. Run Wave 1 in two batches of 13 if load stays above 12; agents must not
run `npm run build` until their final check.

**Merging:** integrator merges `wp/*` into `main` after its checks pass, resolves Requests,
re-runs `npm run build && npm test` and a fresh migrate/seed, then tags (`wave1`).

## 9. Agent brief (paste per package)

> You are porting part of the VAREL storefront onto the Astro app template.
> Repo: `C:\Users\Appifylab\Projects\varel-astro` (work in your worktree, branch `wp/<ID>`).
> VAREL source (read-only): `C:\Users\Appifylab\Projects\VAREL`.
> Read `docs/migration/PLAN.md` (all of it), `AGENTS.md`, and the `docs/agent/*.md` topics
> your package touches. Your package: **<ID> · <name>** in §5. Own only the files listed there;
> follow §3. Port VAREL's code and behaviour faithfully; adapt imports, data access and
> routing to the target architecture (§2). Finish with the checks in §3.7, the hand-off note
> `docs/migration/handoff/<ID>.md`, and a commit on your branch.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Wave 0 slips → everything waits | Wave 0 scoped to contracts + stubs; F-packages are disjoint and parallel. |
| Two slices need the same file | Slots pre-created by F3/F5; Requests instead of edits. |
| Stripe Payment Element vs CSP | Per-page CSP on `/checkout/` only (WP-12); simulated provider unblocks QA. |
| Live storage/email/Stripe need owner setup | Outbox email, simulated payments and https seed images work without any owner secret; list required secrets in the README at the end (I1). |
| Islands bloat public JS | `client:visible`, per-island dictionaries, budgets checked in I1. |
| Worker CPU/memory limits | Bounded queries, keyset paging, totals computed once per request; reviewed in I2. |
