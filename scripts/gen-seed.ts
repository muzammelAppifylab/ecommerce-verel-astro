/**
 * Generates `prisma/seed.sql` (fake starter data for the PREVIEW Database) from VAREL's own seed.
 *
 * VAREL's seed (`prisma/seed.ts` + `prisma/data.ts` + `prisma/seed-phase23/**`) prices its orders with
 * the promotions engine, renders its demo emails and hashes its translations, so instead of
 * re-implementing it this script reads the rows it produced and converts them to this schema:
 *
 *   1. A throwaway database with VAREL's schema and seed (run from the VAREL checkout):
 *        docker exec varel-astro-db createdb -U varel varel_seed_src
 *        DATABASE_URL=postgresql://varel:varel@localhost:5436/varel_seed_src npx prisma migrate deploy
 *        DATABASE_URL=postgresql://varel:varel@localhost:5436/varel_seed_src npx tsx prisma/seed.ts
 *   2. Here:
 *        SRC_DATABASE_URL=postgresql://varel:varel@localhost:5436/varel_seed_src npx tsx scripts/gen-seed.ts
 *
 * Conversions (docs/migration/PLAN.md, F1):
 *   - no users: VAREL's accounts, the demo customer's addresses, bag and wishlist are left out; orders,
 *     redemptions and reviews keep `user_id NULL`; every customer email is an `@example.com` address;
 *   - cuid ids → Int ids (stable order: position, date, then the old id); slugs/SKUs stay string ids;
 *   - money → Int cents; discount `value` → `percent_off` / `amount_cents` by kind;
 *   - translations follow the new ids; menu links get D13 URLs (trailing slash, `/login` →
 *     `/account/login/`) and their translations' `source_hash` is recomputed;
 *   - activity dates (orders, reviews, analytics, subscribers, emails, discounts) are written relative
 *     to `now()` at seed time, measured from when VAREL's seed ran, so the demo stays "recent".
 *
 * The output is idempotent: explicit ids + `ON CONFLICT DO NOTHING`, sequences moved past the ids,
 * and the settings row is only written while nobody has edited it (`updated_at = created_at`).
 */
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

import pg from 'pg';

const SRC = process.env.SRC_DATABASE_URL;
if (!SRC) throw new Error('Set SRC_DATABASE_URL to a database seeded by VAREL (see the header of this file).');
const OUT = fileURLToPath(new URL('../prisma/seed.sql', import.meta.url));

type Row = Record<string, unknown>;

const client = new pg.Client({connectionString: SRC});
// Keep numeric/decimal as strings (exact), timestamps as Date.
pg.types.setTypeParser(1700, v => v);

async function rows(sql: string): Promise<Row[]> {
  return (await client.query(sql)).rows as Row[];
}

// ---------------------------------------------------------------- SQL literals

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const str = (v: unknown) => (v == null ? 'NULL' : q(String(v)));
const int = (v: unknown) => (v == null ? 'NULL' : String(Math.trunc(Number(v))));
const bool = (v: unknown) => (v == null ? 'NULL' : v ? 'true' : 'false');
const dec = (v: unknown) => (v == null ? 'NULL' : String(v));
const json = (v: unknown) => (v == null ? 'NULL' : `${q(JSON.stringify(v))}::jsonb`);
const strArr = (v: unknown, type = 'varchar') => {
  const a = (v as string[] | null) ?? [];
  return a.length ? `ARRAY[${a.map(q).join(', ')}]::${type}[]` : `'{}'::${type}[]`;
};
const intArr = (a: number[]) => (a.length ? `ARRAY[${a.join(', ')}]::int[]` : `'{}'::int[]`);

/** Decimal string in major units → integer cents. */
function cents(v: unknown): string {
  if (v == null) return 'NULL';
  const [whole, frac = ''] = String(v).split('.');
  const neg = whole!.startsWith('-');
  const c = Math.abs(Number(whole)) * 100 + Number((frac + '00').slice(0, 2));
  return String(neg ? -c : c);
}

/** When VAREL's seed ran: its analytics end one minute before it. */
let seededAt = Date.now();
/** An instant: absolute, or relative to `now()` at seed time. */
function at(v: unknown, relative: boolean): string {
  if (v == null) return 'NULL';
  const d = v instanceof Date ? v : new Date(String(v));
  if (!relative) return `${q(d.toISOString())}::timestamptz`;
  const ms = seededAt - d.getTime();
  const sign = ms >= 0 ? '-' : '+';
  return `(now() ${sign} interval '${(Math.abs(ms) / 1000).toFixed(3)} seconds')`;
}

/** Customer emails: keep @example.com, map anything else (the demo customer) to one. */
const EMAIL_MAP: Record<string, string> = {'mira@studio.dk': 'mira.halvorsen@example.com'};
function email(v: unknown): string | null {
  if (v == null) return null;
  const e = String(v).toLowerCase();
  if (EMAIL_MAP[e]) return EMAIL_MAP[e]!;
  if (e.endsWith('@example.com') || e.endsWith('@varel.studio')) return e;
  return `${e.split('@')[0]}@example.com`;
}
const scrub = (s: unknown) =>
  s == null ? null : Object.entries(EMAIL_MAP).reduce((t, [from, to]) => t.split(from).join(to), String(s));

/** D13: storefront links end in a slash; VAREL's sign-in pages moved under /account/. */
function d13(url: string): string {
  if (!url.startsWith('/') || url.startsWith('//')) return url;
  const map: Record<string, string> = {'/login': '/account/login/', '/signup': '/account/register/', '/reset-password': '/account/forgot/'};
  const [path, rest = ''] = url.split(/(?=[?#])/);
  const p = map[path!] ?? (path!.endsWith('/') ? path! : `${path}/`);
  return p + rest;
}

/** VAREL `sourceHash` (worker/lib/i18n/translate.ts): first 16 hex of SHA-256 of the text or its JSON. */
const sourceHash = (value: unknown) =>
  createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(value))
    .digest('hex')
    .slice(0, 16);

// ---------------------------------------------------------------- output

const out: string[] = [];
const emit = (s: string) => out.push(s);

function insert(table: string, cols: string[], values: string[][], conflict = 'ON CONFLICT DO NOTHING', chunk = 200) {
  if (!values.length) return;
  for (let i = 0; i < values.length; i += chunk) {
    const part = values.slice(i, i + chunk);
    emit(
      `INSERT INTO "${table}" (${cols.map(c => `"${c}"`).join(', ')}) VALUES\n` +
        part.map(v => `  (${v.join(', ')})`).join(',\n') +
        `\n${conflict};\n`
    );
  }
}
const counts: Record<string, number> = {};
const count = (table: string, n: number) => (counts[table] = (counts[table] ?? 0) + n);
const seq = (table: string) =>
  emit(`SELECT setval(pg_get_serial_sequence('"${table}"', 'id'), GREATEST((SELECT MAX("id") FROM "${table}"), 1));\n`);

/** Old id → new Int id, in the given order. */
function idMap(list: Row[]): Map<string, number> {
  return new Map(list.map((r, i) => [String(r.id), i + 1]));
}

async function main() {
  await client.connect();
  const [{max}] = (await rows('SELECT max("createdAt") AS max FROM "AnalyticsEvent"')) as [{max: Date | null}];
  if (max) seededAt = max.getTime() + 60_000;

  emit(`-- Fake starter data for the PREVIEW Database only: \`npx prisma db execute --file prisma/seed.sql\`
-- (or \`npx prisma db seed\`). Live data never comes from here.
-- GENERATED by scripts/gen-seed.ts from VAREL's seed: do not edit by hand, regenerate.
-- No users: orders, reviews and redemptions are guests' (user_id NULL, @example.com addresses).
-- Safe to run twice: explicit ids, ON CONFLICT DO NOTHING; recent activity is relative to now().
BEGIN;
`);

  // ---- taxonomy
  const depts = await rows('SELECT * FROM "Department" ORDER BY "position", "name", "id"');
  const deptId = idMap(depts);
  emit('-- Taxonomy');
  insert(
    'departments',
    ['id', 'name', 'slug', 'position', 'created_at', 'updated_at'],
    depts.map(d => [int(deptId.get(String(d.id))), str(d.name), str(d.slug), int(d.position), 'now()', 'now()'])
  );
  count('departments', depts.length);
  const cats = await rows(
    'SELECT c.* FROM "Category" c JOIN "Department" d ON d.id = c."departmentId" ORDER BY d."position", d."name", c."position", c."name", c."id"'
  );
  const catId = idMap(cats);
  insert(
    'categories',
    ['id', 'name', 'slug', 'position', 'department_id', 'created_at', 'updated_at'],
    cats.map(c => [
      int(catId.get(String(c.id))),
      str(c.name),
      str(c.slug),
      int(c.position),
      int(deptId.get(String(c.departmentId))),
      'now()',
      'now()',
    ])
  );
  count('categories', cats.length);

  // ---- products
  const products = await rows('SELECT * FROM "Product" ORDER BY "position", "id"');
  emit('-- Products');
  insert(
    'products',
    [
      'id', 'name', 'brand', 'type', 'status', 'price_cents', 'compare_at_cents', 'sku', 'short', 'description', 'material',
      'care', 'tags', 'download', 'position', 'category_position', 'featured', 'allow_backorder', 'cost_cents', 'weight',
      'weight_unit', 'package_length', 'package_width', 'package_height', 'dimension_unit', 'options', 'seo_title',
      'seo_description', 'rating_avg', 'rating_count', 'department_id', 'category_id', 'created_at', 'updated_at',
    ],
    products.map(p => [
      str(p.id), str(p.name), str(p.brand), str(p.type), str(p.status), cents(p.price), cents(p.compareAt), str(p.sku),
      str(p.short), str(p.description), str(p.material), str(p.care), strArr(p.tags), str(p.download), int(p.position),
      int(p.categoryPosition), bool(p.featured), bool(p.allowBackorder), cents(p.costPerItem), dec(p.weight),
      str(p.weightUnit), dec(p.packageLength), dec(p.packageWidth), dec(p.packageHeight), str(p.dimensionUnit),
      json(p.options), str(p.seoTitle), str(p.seoDescription), dec(p.ratingAvg), int(p.ratingCount),
      int(deptId.get(String(p.departmentId))), int(catId.get(String(p.categoryId))), at(p.createdAt, false), 'now()',
    ]),
    'ON CONFLICT DO NOTHING',
    50
  );
  count('products', products.length);

  const images = await rows('SELECT * FROM "ProductImage" ORDER BY "productId", "position", "id"');
  insert(
    'product_images',
    ['id', 'product_id', 'key', 'src', 'credit', 'credit_href', 'position', 'created_at', 'updated_at'],
    images.map((im, i) => [
      int(i + 1), str(im.productId), str(im.key), str(im.src), str(im.credit), str(im.creditHref), int(im.position), 'now()', 'now()',
    ])
  );
  count('product_images', images.length);
  seq('product_images');

  const variants = await rows('SELECT * FROM "Variant" ORDER BY "productId", "position", "id"');
  insert(
    'variants',
    ['id', 'product_id', 'color', 'size', 'swatch', 'options', 'price_cents', 'inventory', 'position', 'created_at', 'updated_at'],
    variants.map(v => [
      str(v.id), str(v.productId), str(v.color), str(v.size), str(v.swatch), json(v.options), cents(v.price), int(v.inventory),
      int(v.position), 'now()', 'now()',
    ])
  );
  count('variants', variants.length);

  // ---- journal
  const posts = await rows('SELECT * FROM "Post" ORDER BY "publishedAt" NULLS LAST, "createdAt", "id"');
  const postId = idMap(posts);
  emit('-- Journal');
  insert(
    'posts',
    [
      'id', 'slug', 'title', 'category', 'status', 'published_at', 'read', 'author', 'excerpt', 'image', 'body', 'seo_title',
      'seo_description', 'created_at', 'updated_at',
    ],
    posts.map(p => [
      int(postId.get(String(p.id))), str(p.slug), str(p.title), str(p.category), str(p.status), at(p.publishedAt, false),
      str(p.read), str(p.author), str(p.excerpt), json(p.image), json(p.body), str(p.seoTitle), str(p.seoDescription),
      at(p.publishedAt ?? p.createdAt, false), at(p.publishedAt ?? p.createdAt, false),
    ]),
    'ON CONFLICT DO NOTHING',
    20
  );
  count('posts', posts.length);
  seq('posts');

  // ---- discounts
  const discounts = await rows('SELECT * FROM "Discount" ORDER BY "createdAt", "id"');
  const discountId = idMap(discounts);
  emit('-- Discounts');
  insert(
    'discounts',
    [
      'id', 'method', 'name', 'code', 'code_type', 'kind', 'percent_off', 'amount_cents', 'max_amount_cents', 'buy_qty', 'get_qty',
      'get_percent', 'scope', 'product_ids', 'category_ids', 'department_ids', 'label', 'minimum_cents', 'minimum_qty',
      'eligibility', 'customer_ids', 'per_customer_limit', 'combinable', 'priority', 'note', 'active', 'starts_at', 'ends_at',
      'usage_limit', 'created_at', 'updated_at',
    ],
    discounts.map(d => [
      int(discountId.get(String(d.id))), str(d.method), str(d.name), str(d.code), str(d.codeType), str(d.kind),
      d.kind === 'percent' ? dec(d.value) : 'NULL', d.kind === 'fixed' ? cents(d.value) : 'NULL', cents(d.maxAmount),
      int(d.buyQty), int(d.getQty), int(d.getPercent), str(d.scope), strArr(d.productIds),
      intArr(((d.categoryIds as string[]) ?? []).map(id => catId.get(id)!).filter(Boolean)),
      intArr(((d.departmentIds as string[]) ?? []).map(id => deptId.get(id)!).filter(Boolean)),
      str(d.label), cents(d.minimum), int(d.minimumQty), str(d.eligibility), intArr([]), int(d.perCustomerLimit),
      bool(d.combinable), int(d.priority), str(d.note), bool(d.active), at(d.startsAt, true), at(d.endsAt, true),
      int(d.usageLimit), at(d.createdAt, true), at(d.updatedAt, true),
    ])
  );
  count('discounts', discounts.length);
  seq('discounts');

  // ---- store config
  const [s] = await rows('SELECT * FROM "Setting" WHERE id = 1');
  emit('-- Store settings: only while nobody has edited the row the migration created.');
  if (s) {
    const set: [string, string][] = [
      ['store_name', str(s.storeName)], ['currency', str(s.currency)], ['tax_name', str(s.taxName)], ['tax_rate', dec(s.taxRate)],
      ['free_shipping_threshold_cents', cents(s.freeShippingThreshold)], ['announcement', str(s.announcement)],
      ['support_email', str(s.supportEmail)], ['low_stock_threshold', int(s.lowStockThreshold)],
      ['return_window_days', int(s.returnWindowDays)], ['prices_include_tax', bool(s.pricesIncludeTax)],
      ['tax_digital', bool(s.taxDigital)], ['tax_shipping', bool(s.taxShipping)], ['legal_name', str(s.legalName)],
      ['vat_number', str(s.vatNumber)], ['business_address', str(s.businessAddress)], ['phone', str(s.phone)],
      ['logo_url', str(s.logoUrl)], ['social_links', json(s.socialLinks)], ['order_prefix', str(s.orderPrefix)],
      ['guest_checkout', bool(s.guestCheckout)], ['require_phone', bool(s.requirePhone)], ['order_notes', bool(s.orderNotes)],
      ['terms_text', str(s.termsText)], ['hide_sold_out', bool(s.hideSoldOut)], ['return_reasons', strArr(s.returnReasons)],
      ['refund_shipping', bool(s.refundShipping)], ['payment_provider', str(s.paymentProvider)],
      ['stripe_publishable_key', str(s.stripePublishableKey)], ['email_provider', str(s.emailProvider)],
      ['email_config', json(s.emailConfig)], ['email_from_name', str(s.emailFromName)],
      ['email_from_address', str(s.emailFromAddress)], ['email_reply_to', str(s.emailReplyTo)],
      ['staff_alert_email', str(s.staffAlertEmail)], ['seo_title', str(s.seoTitle)], ['seo_description', str(s.seoDescription)],
      ['og_image', str(s.ogImage)], ['home_hero', json(s.homeHero)], ['cookie_consent', bool(s.cookieConsent)],
      ['abandoned_cart_enabled', bool(s.abandonedCartEnabled)], ['abandoned_cart_hours', int(s.abandonedCartHours)],
      ['reviews_enabled', bool(s.reviewsEnabled)], ['reviews_require_approval', bool(s.reviewsRequireApproval)],
      ['reviews_verified_only', bool(s.reviewsVerifiedOnly)], ['analytics_enabled', bool(s.analyticsEnabled)],
      ['default_locale', str(s.defaultLocale)], ['locales', strArr(s.locales)],
      ['translation_provider', str(s.translationProvider)], ['auto_translate', bool(s.autoTranslate)],
    ];
    emit(
      `INSERT INTO "settings" ("id", "updated_at") VALUES (1, CURRENT_TIMESTAMP) ON CONFLICT ("id") DO NOTHING;\n` +
        `UPDATE "settings" SET\n${set.map(([c, v]) => `  "${c}" = ${v}`).join(',\n')},\n  "updated_at" = "created_at"\n` +
        `WHERE "id" = 1 AND "updated_at" = "created_at";\n`
    );
  }

  const zones = await rows('SELECT * FROM "ShippingZone" ORDER BY "position", "id"');
  emit('-- Shipping');
  insert(
    'shipping_zones',
    ['id', 'name', 'position', 'countries', 'created_at', 'updated_at'],
    zones.map(z => [str(z.id), str(z.name), int(z.position), strArr(z.countries), 'now()', 'now()'])
  );
  count('shipping_zones', zones.length);
  const methods = await rows('SELECT m.* FROM "ShippingMethod" m JOIN "ShippingZone" z ON z.id = m."zoneId" ORDER BY z."position", m."position", m."id"');
  insert(
    'shipping_methods',
    ['id', 'zone_id', 'name', 'detail', 'rate_cents', 'position', 'created_at', 'updated_at'],
    methods.map(m => [str(m.id), str(m.zoneId), str(m.name), str(m.detail), cents(m.rate), int(m.position), 'now()', 'now()'])
  );
  count('shipping_methods', methods.length);

  const taxRates = await rows('SELECT * FROM "TaxRate" ORDER BY "country"');
  insert(
    'tax_rates',
    ['id', 'country', 'rate', 'name', 'created_at', 'updated_at'],
    taxRates.map((t, i) => [int(i + 1), str(t.country), dec(t.rate), str(t.name), 'now()', 'now()'])
  );
  count('tax_rates', taxRates.length);
  if (taxRates.length) seq('tax_rates');

  // ---- orders (guests only)
  const orders = await rows('SELECT * FROM "Order" ORDER BY "placedAt", "number"');
  const orderId = idMap(orders);
  emit('-- Orders (as guests)');
  insert(
    'shop_orders',
    [
      'id', 'number', 'user_id', 'email', 'phone', 'payment', 'fulfillment', 'stage', 'carrier', 'tracking', 'tracking_url',
      'method', 'address', 'billing_same_as_shipping', 'billing_address', 'card_brand', 'card_last4', 'subtotal_cents',
      'discount_code', 'discount_id', 'released_discounts', 'discount_cents', 'shipping_cents', 'tax_cents', 'total_cents',
      'currency', 'locale', 'prices_include_tax', 'tax_rate', 'customer_note', 'payment_provider', 'note', 'placed_at',
      'created_at', 'updated_at',
    ],
    orders.map(o => [
      int(orderId.get(String(o.id))), str(o.number), 'NULL', str(email(o.email)), str(o.phone), str(o.payment),
      str(o.fulfillment), int(o.stage), str(o.carrier), str(o.tracking), str(o.trackingUrl), str(o.method), json(o.address),
      bool(o.billingSameAsShipping), json(o.billingAddress), str(o.cardBrand), str(o.cardLast4), cents(o.subtotal),
      str(o.discountCode), o.discountId ? int(discountId.get(String(o.discountId))) : 'NULL', json(o.releasedDiscounts),
      cents(o.discount), cents(o.shipping), cents(o.tax), cents(o.total), str(o.currency), str(o.locale),
      bool(o.pricesIncludeTax), dec(o.taxRate), str(o.customerNote), str(o.paymentProvider), str(o.note),
      at(o.placedAt, true), at(o.placedAt, true), at(o.placedAt, true),
    ]),
    'ON CONFLICT DO NOTHING',
    50
  );
  count('shop_orders', orders.length);
  seq('shop_orders');

  const items = await rows(
    'SELECT i.*, o."placedAt" FROM "OrderItem" i JOIN "Order" o ON o.id = i."orderId" ORDER BY o."placedAt", o."number", i."position", i."id"'
  );
  const itemId = idMap(items);
  insert(
    'shop_order_items',
    [
      'id', 'order_id', 'product_id', 'name', 'category', 'sku', 'color', 'size', 'options', 'qty', 'price_cents',
      'discount_cents', 'digital', 'image', 'download', 'position', 'created_at',
    ],
    items.map(i => [
      int(itemId.get(String(i.id))), int(orderId.get(String(i.orderId))), str(i.productId), str(i.name), str(i.category),
      str(i.sku), str(i.color), str(i.size), json(i.options), int(i.qty), cents(i.price), cents(i.discount), bool(i.digital),
      json(i.image), str(i.download), int(i.position), at(i.placedAt, true),
    ])
  );
  count('shop_order_items', items.length);
  seq('shop_order_items');

  const events = await rows(
    'SELECT e.* FROM "OrderEvent" e JOIN "Order" o ON o.id = e."orderId" ORDER BY o."placedAt", o."number", e."at", e."id"'
  );
  insert(
    'shop_order_events',
    ['id', 'order_id', 'kind', 'message', 'by', 'at'],
    events.map((e, i) => [int(i + 1), int(orderId.get(String(e.orderId))), str(e.kind), str(scrub(e.message)), str(e.by), at(e.at, true)])
  );
  count('shop_order_events', events.length);
  seq('shop_order_events');

  const returns = await rows('SELECT * FROM "ReturnRequest" ORDER BY "createdAt", "id"');
  insert(
    'return_requests',
    ['id', 'order_id', 'email', 'status', 'items', 'note', 'created_at', 'updated_at'],
    returns.map((r, i) => [
      int(i + 1), int(orderId.get(String(r.orderId))), str(email(r.email)), str(r.status),
      json(
        ((r.items as {lineId: string; qty: number; reason: string}[]) ?? []).map(l => ({
          ...l,
          lineId: itemId.get(String(l.lineId)) ?? null,
        }))
      ),
      str(r.note), at(r.createdAt, true), at(r.updatedAt, true),
    ])
  );
  count('return_requests', returns.length);
  if (returns.length) seq('return_requests');

  const payments = await rows('SELECT * FROM "Payment" ORDER BY "createdAt", "id"');
  insert(
    'shop_payments',
    [
      'id', 'order_id', 'provider', 'provider_ref', 'status', 'amount_cents', 'refunded_cents', 'currency', 'card_brand',
      'card_last4', 'failure_message', 'created_at', 'updated_at',
    ],
    payments.map((p, i) => [
      int(i + 1), int(orderId.get(String(p.orderId))), str(p.provider), str(p.providerRef), str(p.status), cents(p.amount),
      cents(p.refunded), str(p.currency), str(p.cardBrand), str(p.cardLast4), str(p.failureMessage), at(p.createdAt, true),
      at(p.updatedAt, true),
    ])
  );
  count('shop_payments', payments.length);
  if (payments.length) seq('shop_payments');

  // Unique codes (after orders: a used code points at its order).
  const codes = await rows('SELECT * FROM "DiscountCode" ORDER BY "code"');
  insert(
    'discount_codes',
    ['id', 'discount_id', 'code', 'used_at', 'order_id', 'created_at', 'updated_at'],
    codes.map((c, i) => [
      int(i + 1), int(discountId.get(String(c.discountId))), str(c.code), at(c.usedAt, true),
      c.orderId ? int(orderId.get(String(c.orderId))) : 'NULL', at(c.createdAt, true), at(c.createdAt, true),
    ])
  );
  count('discount_codes', codes.length);
  seq('discount_codes');

  const redemptions = await rows('SELECT * FROM "DiscountRedemption" ORDER BY "createdAt", "id"');
  insert(
    'discount_redemptions',
    ['id', 'discount_id', 'order_id', 'user_id', 'email', 'code', 'label', 'free_shipping', 'amount_cents', 'created_at'],
    redemptions.map((r, i) => [
      int(i + 1), int(discountId.get(String(r.discountId))), int(orderId.get(String(r.orderId))), 'NULL', str(email(r.email)),
      str(r.code), str(r.label), bool(r.freeShipping), cents(r.amount), at(r.createdAt, true),
    ])
  );
  count('discount_redemptions', redemptions.length);
  seq('discount_redemptions');

  // ---- misc
  const subscribers = await rows('SELECT * FROM "NewsletterSubscriber" ORDER BY "createdAt", "email"');
  emit('-- Newsletter, contact');
  insert(
    'newsletter_subscribers',
    ['id', 'email', 'source', 'created_at', 'updated_at'],
    subscribers.map((n, i) => [int(i + 1), str(email(n.email)), str(n.source), at(n.createdAt, true), at(n.createdAt, true)])
  );
  count('newsletter_subscribers', subscribers.length);
  seq('newsletter_subscribers');

  const contact = await rows('SELECT * FROM "ContactMessage" ORDER BY "createdAt", "id"');
  insert(
    'contact_messages',
    ['id', 'name', 'email', 'subject', 'order_number', 'message', 'read', 'archived', 'created_at', 'updated_at'],
    contact.map((m, i) => [
      int(i + 1), str(m.name), str(email(m.email)), str(m.subject), str(m.order), str(m.message), bool(m.read), bool(m.archived),
      at(m.createdAt, true), at(m.createdAt, true),
    ])
  );
  count('contact_messages', contact.length);
  if (contact.length) seq('contact_messages');

  // ---- merchandising & content
  const collections = await rows('SELECT * FROM "Collection" ORDER BY "position", "createdAt", "id"');
  const collectionId = idMap(collections);
  emit('-- Collections, pages, menus');
  insert(
    'collections',
    [
      'id', 'slug', 'title', 'description', 'image', 'published', 'featured_on_home', 'position', 'seo_title', 'seo_description',
      'created_at', 'updated_at',
    ],
    collections.map(c => [
      int(collectionId.get(String(c.id))), str(c.slug), str(c.title), str(c.description), json(c.image), bool(c.published),
      bool(c.featuredOnHome), int(c.position), str(c.seoTitle), str(c.seoDescription), 'now()', 'now()',
    ])
  );
  count('collections', collections.length);
  seq('collections');
  const cps = await rows('SELECT * FROM "CollectionProduct" ORDER BY "collectionId", "position"');
  insert(
    'collection_products',
    ['collection_id', 'product_id', 'position'],
    cps.map(cp => [int(collectionId.get(String(cp.collectionId))), str(cp.productId), int(cp.position)])
  );
  count('collection_products', cps.length);

  const pages = await rows('SELECT * FROM "Page" ORDER BY "createdAt", "slug"');
  const pageId = idMap(pages);
  insert(
    'pages',
    ['id', 'slug', 'title', 'body', 'published', 'seo_title', 'seo_description', 'created_at', 'updated_at'],
    pages.map(p => [
      int(pageId.get(String(p.id))), str(p.slug), str(p.title), json(p.body), bool(p.published), str(p.seoTitle),
      str(p.seoDescription), 'now()', 'now()',
    ])
  );
  count('pages', pages.length);
  seq('pages');

  const menus = await rows('SELECT * FROM "Menu" ORDER BY "key"');
  const menuId = idMap(menus);
  /** Menu items with D13 links (the source the menu translations hash). */
  const menuItems = new Map<string, {label: string; url: string}[]>();
  for (const m of menus) {
    menuItems.set(
      String(m.id),
      ((m.items as {label: string; url: string}[]) ?? []).map(it => ({...it, url: d13(it.url)}))
    );
  }
  insert(
    'menus',
    ['id', 'key', 'title', 'items', 'created_at', 'updated_at'],
    menus.map(m => [int(menuId.get(String(m.id))), str(m.key), str(m.title), json(menuItems.get(String(m.id))), 'now()', 'now()'])
  );
  count('menus', menus.length);
  seq('menus');

  // ---- email
  const templates = await rows('SELECT * FROM "EmailTemplate" ORDER BY "key"');
  emit('-- Email');
  insert(
    'email_templates',
    ['key', 'subject', 'body', 'enabled', 'created_at', 'updated_at'],
    templates.map(t => [str(t.key), str(t.subject), str(t.body), bool(t.enabled), 'now()', 'now()'])
  );
  count('email_templates', templates.length);
  const messages = await rows('SELECT * FROM "EmailMessage" ORDER BY "createdAt", "id"');
  insert(
    'email_messages',
    [
      'id', 'template', 'to', 'subject', 'html', 'text', 'provider', 'status', 'error', 'provider_id', 'related_type', 'related_id',
      'created_at', 'sent_at',
    ],
    messages.map((m, i) => [
      int(i + 1), str(m.template), str(email(m.to)), str(m.subject), str(scrub(m.html)), str(scrub(m.text)), str(m.provider),
      str(m.status), str(m.error), str(m.providerId), str(m.relatedType), 'NULL', at(m.createdAt, true), at(m.sentAt, true),
    ]),
    'ON CONFLICT DO NOTHING',
    10
  );
  count('email_messages', messages.length);
  seq('email_messages');

  // ---- reviews & analytics
  const reviews = await rows('SELECT * FROM "Review" ORDER BY "createdAt", "id"');
  const reviewId = idMap(reviews);
  emit('-- Reviews, analytics');
  insert(
    'reviews',
    [
      'id', 'product_id', 'user_id', 'name', 'email', 'rating', 'title', 'body', 'status', 'verified_purchase', 'reply', 'created_at',
      'updated_at',
    ],
    reviews.map(r => [
      int(reviewId.get(String(r.id))), str(r.productId), 'NULL', str(r.name), str(email(r.email)), int(r.rating), str(r.title),
      str(r.body), str(r.status), bool(r.verifiedPurchase), str(r.reply), at(r.createdAt, true), at(r.updatedAt, true),
    ])
  );
  count('reviews', reviews.length);
  seq('reviews');

  const analytics = await rows('SELECT * FROM "AnalyticsEvent" ORDER BY "createdAt", "id"');
  insert(
    'analytics_events',
    ['id', 'type', 'session_id', 'user_id', 'product_id', 'order_id', 'query', 'results', 'value_cents', 'path', 'created_at'],
    analytics.map((e, i) => [
      int(i + 1), str(e.type), str(e.sessionId), 'NULL', str(e.productId),
      e.orderId ? int(orderId.get(String(e.orderId)) ?? null) : 'NULL', str(e.query), int(e.results), cents(e.value),
      str(e.path), at(e.createdAt, true),
    ]),
    'ON CONFLICT DO NOTHING',
    500
  );
  count('analytics_events', analytics.length);
  seq('analytics_events');

  // ---- translations (entity ids follow the new ids)
  const remap: Record<string, Map<string, number>> = {
    department: deptId,
    category: catId,
    post: postId,
    page: pageId,
    collection: collectionId,
    menu: menuId,
    discount: discountId,
    review_reply: reviewId,
  };
  const translations = await rows('SELECT * FROM "Translation" ORDER BY "entity", "entityId", "field", "locale"');
  emit('-- Translations');
  const tRows: string[][] = [];
  for (const t of translations) {
    const map = remap[String(t.entity)];
    let entityId = String(t.entityId);
    if (map) {
      const id = map.get(entityId);
      if (id == null) continue;
      entityId = String(id);
    }
    let value = String(t.value);
    let hash = String(t.sourceHash);
    if (t.entity === 'menu' && t.field === 'items') {
      const source = menus.find(m => String(m.id) === String(t.entityId));
      const stale = source && sourceHash(source.items) !== hash;
      value = JSON.stringify((JSON.parse(value) as {label: string; url: string}[]).map(it => ({...it, url: d13(it.url)})));
      // Fresh stays fresh: hash the D13 source items, as the app will.
      if (!stale) hash = sourceHash(menuItems.get(String(t.entityId)));
    }
    tRows.push([
      int(tRows.length + 1), str(t.entity), str(entityId), str(t.field), str(t.locale), str(value), str(t.source), str(hash),
      'now()', 'now()',
    ]);
  }
  insert(
    'translations',
    ['id', 'entity', 'entity_id', 'field', 'locale', 'value', 'source', 'source_hash', 'created_at', 'updated_at'],
    tRows,
    'ON CONFLICT DO NOTHING',
    100
  );
  count('translations', tRows.length);
  seq('translations');

  // Sequences of the remaining Int tables.
  for (const t of ['departments', 'categories']) seq(t);

  emit('COMMIT;\n');
  writeFileSync(OUT, out.join('\n'));
  await client.end();
  console.log(`wrote ${OUT}`);
  for (const [t, n] of Object.entries(counts)) console.log(`  ${t.padEnd(24)} ${n}`);
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
  void client.end();
});
