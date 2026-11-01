-- VAREL staff role and area permissions (docs/migration/PLAN.md §7, D5).
-- IDEMPOTENT, matched by slug / codename (never by id), like 20261019090200_seed_roles.
--
-- The codenames are the ones declared in `CATALOGUE` (src/server/permissions.ts, package F3).
-- They are inserted here so the default grants below exist from the first deploy, before
-- the first signed-in request runs `syncPermissions` (which then only refreshes titles,
-- descriptions and groups from the catalogue: the catalogue stays the source of truth).
BEGIN;

-- VAREL `User.role = staff`: back-office staff. A system role (kept by the tests' reset
-- and by the roles screen's delete), editable by owners. Per-staff area restriction is a
-- custom role made in /dashboard/roles.
INSERT INTO "roles" ("slug", "name", "description", "is_system", "updated_at") VALUES
  ('staff', 'Staff', 'Runs the shop day to day: orders, customers, products, content, discounts and analytics.', true, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;

-- One codename per VAREL admin area.
INSERT INTO "permissions" ("codename", "title", "description", "group_name") VALUES
  ('site:shop_order:manage',     'Manage orders',         'See, fulfil, refund and cancel orders and returns; abandoned bags.', 'Shop'),
  ('site:customer:manage',       'Manage customers',      'See customers and their orders; manage newsletter subscribers.',     'Shop'),
  ('site:product:manage',        'Manage products',       'Products, variants, inventory, departments, categories and collections.', 'Shop'),
  ('site:content:manage',        'Manage content',        'Journal posts, pages, navigation, reviews and translations.',        'Shop'),
  ('site:discount:manage',       'Manage discounts',      'Create, edit and report on discount codes and promotions.',         'Shop'),
  ('site:analytics:read',        'See analytics',         'The overview dashboard, sales and storefront analytics.',           'Shop'),
  ('site:store_settings:manage', 'Manage store settings', 'Store, tax, shipping, payments, emails and languages.',             'Shop')
ON CONFLICT ("codename") DO NOTHING;

-- Default grants (§7). `site:user:*` (staff area) is already the admin's (seed_roles).
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM (VALUES
  ('admin', 'site:shop_order:manage'),
  ('admin', 'site:customer:manage'),
  ('admin', 'site:product:manage'),
  ('admin', 'site:content:manage'),
  ('admin', 'site:discount:manage'),
  ('admin', 'site:analytics:read'),
  ('admin', 'site:store_settings:manage'),
  ('staff', 'site:shop_order:manage'),
  ('staff', 'site:customer:manage'),
  ('staff', 'site:product:manage'),
  ('staff', 'site:content:manage'),
  ('staff', 'site:discount:manage'),
  ('staff', 'site:analytics:read')
) AS g(slug, codename)
JOIN "roles" r ON r."slug" = g.slug
JOIN "permissions" p ON p."codename" = g.codename
ON CONFLICT DO NOTHING;

COMMIT;
