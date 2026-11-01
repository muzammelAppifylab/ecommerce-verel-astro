import {db} from './harness';

/* Abandoned-bag fixtures (WP-24): one published product with a variant, bags with back-dated activity, orders. */

export const HOUR = 3_600_000;
const ago = (h: number) => new Date(Date.now() - h * HOUR);

export async function catalogFixture() {
  const dept = await db.department.create({data: {name: 'Women', slug: 'women'}});
  const cat = await db.category.create({data: {name: 'Coats', slug: 'coats', departmentId: dept.id}});
  await db.product.create({
    data: {
      id: 'wool-coat',
      name: 'Wool coat',
      brand: 'VAREL',
      priceCents: 2500,
      sku: 'WC-1',
      short: 'A coat',
      description: 'A coat',
      material: 'Wool',
      departmentId: dept.id,
      categoryId: cat.id,
    },
  });
  for (const size of ['M', 'L', 'S']) await db.variant.create({data: {id: `wool-coat-stone-${size.toLowerCase()}`, productId: 'wool-coat', color: 'Stone', size, priceCents: 2500}});
}

/** A bag with lines added `lineAgo` hours ago; the cart row last touched `updatedAgo` hours ago. Returns its id. */
export async function bagFixture(o: {
  email: string | null;
  userId?: number;
  updatedAgo: number;
  lineAgo: number[];
  qty?: number;
  reminderAgo?: number;
  dismissedAgo?: number;
  locale?: string;
}): Promise<number> {
  const oldest = Math.max(o.updatedAgo, ...o.lineAgo) + 1;
  const cart = await db.cart.create({
    data: {
      email: o.email,
      userId: o.userId ?? null,
      locale: o.locale ?? null,
      reminderSentAt: o.reminderAgo === undefined ? null : ago(o.reminderAgo),
      dismissedAt: o.dismissedAgo === undefined ? null : ago(o.dismissedAgo),
      createdAt: ago(oldest),
    },
  });
  for (const [i, h] of o.lineAgo.entries()) {
    const variant = ['wool-coat-stone-m', 'wool-coat-stone-l', 'wool-coat-stone-s'][i]!;
    await db.$executeRaw`INSERT INTO "cart_lines" ("cart_id", "product_id", "variant_id", "qty", "created_at", "updated_at")
      VALUES (${cart.id}, 'wool-coat', ${variant}, ${o.qty ?? 1}, ${ago(h)}, ${ago(h)})`;
  }
  await db.$executeRaw`UPDATE "carts" SET "updated_at" = ${ago(o.updatedAgo)} WHERE "id" = ${cart.id}`;
  return cart.id;
}

let n = 0;
export async function orderFixture(o: {email: string; userId?: number; placedAgo: number; totalCents?: number; payment?: string; fulfillment?: string}) {
  n++;
  return db.shopOrder.create({
    data: {
      number: `VRL-T${Date.now() % 100000}${n}`,
      email: o.email,
      userId: o.userId ?? null,
      method: 'Standard',
      subtotalCents: o.totalCents ?? 5000,
      totalCents: o.totalCents ?? 5000,
      payment: o.payment ?? 'Paid',
      fulfillment: o.fulfillment ?? 'Unfulfilled',
      placedAt: ago(o.placedAgo),
    },
  });
}
