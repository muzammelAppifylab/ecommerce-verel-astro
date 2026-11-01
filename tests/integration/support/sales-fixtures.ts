/* Fixtures for the orders and returns admin integration tests (WP-19). */
import {expect} from 'vitest';

import {app} from '../../../src/server/app';
import {db, signedIn, userId} from './harness';

export async function seedCatalog() {
  const dept = await db.department.create({data: {name: 'Women', slug: 'women'}, select: {id: true}});
  const cat = await db.category.create({data: {name: 'Knitwear', slug: 'knitwear', departmentId: dept.id}, select: {id: true}});
  await db.product.create({
    data: {
      id: 'wool-sweater',
      name: 'Wool sweater',
      brand: 'VAREL',
      priceCents: 10000,
      sku: 'WS',
      short: 'Warm',
      description: 'Warm',
      material: 'Wool',
      departmentId: dept.id,
      categoryId: cat.id,
      variants: {
        create: [
          {id: 'WS-M', priceCents: 10000, inventory: 5},
          {id: 'WS-L', priceCents: 5000, inventory: 5},
          {id: 'WS-UNTRACKED', priceCents: 5000, inventory: null},
        ],
      },
    },
  });
}

const image = {src: 'https://images.unsplash.com/photo-1', alt: ''};

/** An order with two physical lines (1 × 100, 2 × 50) and a digital one; totals in cents. */
export async function makeOrder(over: Partial<{number: string; email: string; payment: string; fulfillment: string; placedAt: Date; userId: number | null; name: string; shippingCents: number}> = {}) {
  const shipping = over.shippingCents ?? 0;
  return db.shopOrder.create({
    data: {
      number: over.number ?? 'VRL-24817',
      email: over.email ?? 'ann@example.test',
      userId: over.userId ?? null,
      payment: over.payment ?? 'Paid',
      fulfillment: over.fulfillment ?? 'Unfulfilled',
      method: 'Standard',
      address: {name: over.name ?? 'Ann Lee', line1: '1 Road', city: 'Copenhagen', zip: '1000', country: 'DK'},
      subtotalCents: 20900,
      shippingCents: shipping,
      totalCents: 20900 + shipping,
      placedAt: over.placedAt ?? new Date('2026-10-10T10:00:00Z'),
      items: {
        create: [
          {name: 'Wool sweater', category: 'Knitwear', sku: 'WS-M', qty: 1, priceCents: 10000, image, position: 0, productId: 'wool-sweater'},
          {name: 'Wool sweater', category: 'Knitwear', sku: 'WS-L', qty: 2, priceCents: 5000, image, position: 1, productId: 'wool-sweater'},
          {name: 'Pattern', category: 'Digital', sku: 'PDF', qty: 1, priceCents: 900, image, digital: true, position: 2},
        ],
      },
    },
    select: {id: true, number: true, items: {select: {id: true, sku: true}, orderBy: {position: 'asc'}}},
  });
}

export async function staffSetup() {
  const owner = await signedIn(app, 'owner@example.test', undefined, '203.0.113.21');
  const staff = await signedIn(app, 'staff@example.test', undefined, '203.0.113.22');
  const customer = await signedIn(app, 'customer@example.test', undefined, '203.0.113.23');
  const id = await userId('staff@example.test');
  const made = await owner.request('PUT', `/site-api/admin/users/${id}/roles`, {roles: ['member', 'staff']});
  expect(made.status).toBe(200);
  return {owner, staff, customer};
}

