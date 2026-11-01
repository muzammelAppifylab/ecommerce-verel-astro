# Site — Astro app

A starter for a **website plus its own app**, built with [Astro](https://astro.build) on one
Cloudflare Worker:

- **Pages**: a home page made of sections and an about page (prerendered, served as files), a
  **blog** written as Markdown files (`src/content/blog/`, one page per post), and a **job board** with search and detail pages;
- **accounts of its own**: sign-up with email confirmation, sign-in, password reset, "sign out
  everywhere" — stored in your Site Database, secured with PBKDF2 passwords, short-lived signed
  tokens, rotating refresh tokens and rate limits;
- **roles and permissions**: owner, admin and member out of the box, custom roles, and admin
  screens for users, roles and an activity log;
- a **dashboard** at `/dashboard` — a React app with [TanStack Router](https://tanstack.com/router)
  and [TanStack Query](https://tanstack.com/query), built on its own UI kit (`src/portal/ui/`:
  shell, cards, tables, drawers, dialogs, toasts, menus, forms, charts; light and dark), ready
  to build your own screens on (`docs/agent/ui.md`);
- your own **backend** at `/site-api` — a [Hono](https://hono.dev) app every page and screen
  reads through;
- your own **Site Database** — Prisma Postgres, through [Prisma ORM 7](https://www.prisma.io).

One project, one build, one deploy.

## Put it live

Pick **Astro app** when you create a site in the dashboard (or turn on "make it an app"), change what
you like in the editor (or ask your AI agent), then **Publish**.

**Enable the Site Database first.** This project ships migrations; a version with migrations is
refused until the site has a database. The platform gives the live site your account owner's email
at each Publish, so only that address (plus any you add to `ownerEmails` in
`src/server/auth-settings.ts`) can claim the owner role: the first stranger to sign up can't. With
no owner email at all, nobody becomes owner on the live site.

The platform sees `astro` and `@astrojs/cloudflare`, installs with `npm ci`, runs
`npm run build` (`prisma generate && astro build`), applies new migrations to your live database,
then deploys. If a migration fails, the previous version keeps serving.

## Owner setup for the live store (VAREL)

The store works without any of this: card payments run on the **simulated** provider, store
emails are kept in the **outbox** (Dashboard › Settings › Emails) instead of being sent, seed
images are https links, and machine translation is off. Each item below turns one real service
on. Secrets are added by the owner in the site's dashboard (the app's **Secrets**); the code only
reads them through `config.ownerSecret('NAME')`, never from a file. Never put a key in the repo,
`.env` or a chat.

| # | What | Where | Names / values |
| --- | --- | --- | --- |
| 1 | **Site Database** | the app's Database tab, before the first Publish | — (migrations are refused without it) |
| 2 | **Owner account** | automatic: the account owner's email (plus `ownerEmails` in `src/server/auth-settings.ts`) | sign in at `/dashboard` with the emailed code |
| 3 | **Stripe** (real card payments) | secrets: `STRIPE_SECRET_KEY` (`sk_test_…` first, `sk_live_…` to go live), `STRIPE_WEBHOOK_SECRET` (`whsec_…`) · Dashboard › Settings › Payments: provider **Stripe** + the publishable key (`pk_…`, public) | Stripe webhook endpoint: `https://<your domain>/site-api/webhooks/stripe`, events `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`, `charge.refunded`. The Payments screen shows whether each key is set and its test/live mode: keep all three in the same mode. |
| 4 | **Store emails** (order confirmation, shipping, refunds, returns, abandoned bag, newsletter) | secret `EMAIL_API_KEY` (Resend or Postmark API key, or the shared secret of your webhook) · Dashboard › Settings › Emails: provider, sender name and address | The sender's domain must be verified at the provider (SPF/DKIM). Account emails (confirm, reset, sign-in codes) are sent by the platform and need nothing here. |
| 5 | **File storage** (product, collection and journal images uploaded in the dashboard; digital downloads) | the app's **Storage** tab: a storage pack, then "Turn on" | Without it uploads stop with a clear message; https image links keep working. |
| 6 | **Machine translation** (optional) | Workers AI: secrets `CF_ACCOUNT_ID` + `CF_AI_TOKEN` (an API token with Workers AI permission) · or DeepL: `DEEPL_API_KEY` · Dashboard › Settings › Languages: provider | Runs hourly in the background (`translations-backfill`); hand translations always win. |
| 7 | **Custom domain** (optional) | the app's Domains tab; then `SITE.url` in `src/content/site.ts` (`https://www.example.com`, no trailing slash) and Publish | Canonical URLs, hreflang, the sitemap, RSS and social cards use it. Update the Stripe webhook URL to the new domain. |
| 8 | **Store details for search and social** | Dashboard › Settings: store name, SEO title and description, share image (1200×630), logo, support email, phone, legal name, social links, enabled languages | Feeds `<title>`, Open Graph, the home page's `Organization` data and the sitemap's language alternates. |

Background work (no setup; check it with `npm run platform -- jobs`): abandoned-bag reminders and
unpaid-order expiry every 15 minutes, translations hourly, store emails as they are queued
(`background.json`).

Before going live: switch Stripe to live keys (both secrets and the publishable key, same mode),
send a test order end to end, and check `/sitemap.xml` and `/robots.txt` on the live address.

## What this site controls

| Address | Served by |
| --- | --- |
| `/`, `/shop/…`, `/product/<id>/`, `/collections/…`, `/journal/…`, `/search/`, `/about/`, `/contact/`, `/returns/`, `/privacy/`, `/terms/`, `/pages/<slug>/` | this site (the storefront; `/da/`, `/de/`, `/fr/`, `/es/`, `/sv/` for other languages) |
| `/cart/`, `/checkout/`, `/order/<number>/confirmation/`, `/wishlist/` | this site (per visitor, not indexed) |
| `/sitemap.xml`, `/robots.txt`, `/rss.xml` | this site (search engines, the journal feed) |
| `/account/login`, `/account/register`, `/account/forgot`, … | this site (sign-in) |
| `/account/…` | this site (the customer account: orders, addresses, downloads) |
| `/dashboard/…` | this site (the store admin) |
| `/site-api/…` | this site (your API; `/site-api/webhooks/stripe` for Stripe) |
| `/api/…` | the platform |

## Write a journal post

Journal posts live in the Site Database: write them in Dashboard › Journal (they appear on
`/journal/`, in `/rss.xml` and the sitemap as soon as they are published; no Publish needed).

## Accounts

- The **owner** is the first person to confirm an owner email: your account owner's
  email (set by the platform at each Publish) or an address in `ownerEmails`. Locally and in the
  editor Preview, with no owner email, the first person to confirm becomes owner. Owners and admins manage users at `/dashboard/users` and roles at `/dashboard/roles`.
- Confirmation and password-reset emails are sent by the platform on your site's behalf.
- Change how sign-up works in `src/server/auth-settings.ts`.

## Running it on your machine

```bash
cp .env.example .env     # set SITE_URL, a JWT_SECRET, and a DATABASE_URL to try sign-in
npm install
npx prisma migrate deploy   # creates the tables in that database (once, and after each new migration)
npm run dev              # http://localhost:4321
npm test                 # unit tests (auth crypto, tokens, rate limits)
# + integration tests (real Site API on a real Postgres; EMPTIES that database).
#   A throwaway Postgres, migrated, then the tests against it:
docker run -d --name site-test-pg -p 5470:5432 -e POSTGRES_PASSWORD=dev postgres:16
DATABASE_URL=postgresql://postgres:dev@localhost:5470/postgres npx prisma migrate deploy
TEST_DATABASE_URL=postgresql://postgres:dev@localhost:5470/postgres npm test
npm run build            # the Worker, into dist/
```

`.env` is for your machine only and is git-ignored — never commit it.

## Changing the database

```bash
npx prisma migrate dev --create-only --name add_something   # 1. write the migration
# 2. wrap prisma/migrations/<…>/migration.sql in BEGIN; … COMMIT;
npx prisma migrate dev                                       # 3. apply it to the Preview Database
npx prisma generate                                          # 4. the client gets the new model
```

On your own machine these read `DATABASE_URL` from `.env`.

Migrations only move forward: never edit one that was applied, and change tables in steps (add,
fill, switch, drop later). `docs/agent/database.md` has the rules.

## Staying up to date

```bash
npm run platform -- check     # is a newer template release out?
npm run platform -- upgrade   # apply it, keeping your changes (commit first)
npm run platform -- docs      # the platform's latest agent docs
```

Where releases come from: `repo` in `template.json`. Today it is `file:templates/astro-app`, the
template's folder in a platform checkout (there is no published template repository yet):
set `SITE_DIR` to that checkout, or pass `--from <path to templates/astro-app>`. A folder
holds one version, so for a real 3-way merge also pass `--base <a copy of your current
version>`; without it, `upgrade` adds new files, replaces the managed ones and lists the files
you changed for you to compare. A GitHub `owner/name` with `vX.Y.Z` tags works the same way
once the templates are published.

## Where things are

```
AGENTS.md                rules for AI agents (CLAUDE.md, GEMINI.md import it)
docs/agent/              topic docs: auth, roles, security, performance, database, site API, SEO, publishing
template.json            which template version this site is on
scripts/platform.mjs     npm run platform -- docs | check | upgrade
prisma/                  tables, migrations, seed data
tests/                   unit tests; tests/integration/ = Site API on a real Postgres
public/_headers          security headers for prerendered pages
src/
  content/site.ts        navigation, home sections, about copy, SITE (description, language, address)
  assets/                images optimised at build (blog covers in assets/blog/)
  pages/                 the views (index, about, blog/, jobs/, account/, portal/, site-api/),
                         sitemap.xml, robots.txt, rss.xml
  portal/                the dashboard (React): routes.tsx, screens/, ui/ (the UI kit, docs/agent/ui.md)
  server/                YOUR backend: app.ts, routes/, auth-settings.ts, permissions.ts
  platform/              the MANAGED core (auth, guards, platform API): replaced on upgrade
  lib/                   shared types, form rules, browser form helpers, seo.ts (canonical URLs)
```
