-- VAREL shop schema (docs/migration/PLAN.md, package F1): every VAREL model except
-- User, Session, PasswordResetToken and StaffInvite (D5), with the template's
-- conventions. Wrapped in one transaction: if any statement fails, none apply.
BEGIN;

-- Trigram search (product and journal search).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateTable
CREATE TABLE "customer_profiles" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "first_name" VARCHAR(80) NOT NULL DEFAULT '',
    "last_name" VARCHAR(80) NOT NULL DEFAULT '',
    "phone" VARCHAR(40),
    "locale" VARCHAR(10) NOT NULL DEFAULT 'en',
    "marketing_opt_in" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customer_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visitors" (
    "id" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addresses" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "label" VARCHAR(40),
    "name" VARCHAR(120) NOT NULL,
    "line1" VARCHAR(200) NOT NULL,
    "line2" VARCHAR(200),
    "city" VARCHAR(100) NOT NULL,
    "zip" VARCHAR(20) NOT NULL,
    "country" VARCHAR(80) NOT NULL,
    "phone" VARCHAR(40),
    "primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "department_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" VARCHAR(120) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "brand" VARCHAR(80) NOT NULL,
    "type" VARCHAR(10) NOT NULL DEFAULT 'physical',
    "status" VARCHAR(10) NOT NULL DEFAULT 'published',
    "price_cents" INTEGER NOT NULL,
    "compare_at_cents" INTEGER,
    "sku" VARCHAR(64) NOT NULL,
    "short" VARCHAR(300) NOT NULL,
    "description" VARCHAR(10000) NOT NULL,
    "material" VARCHAR(120) NOT NULL,
    "care" VARCHAR(2000),
    "tags" VARCHAR(40)[] DEFAULT ARRAY[]::VARCHAR(40)[],
    "download" VARCHAR(200),
    "position" INTEGER NOT NULL DEFAULT 0,
    "category_position" INTEGER NOT NULL DEFAULT 0,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "allow_backorder" BOOLEAN NOT NULL DEFAULT false,
    "cost_cents" INTEGER,
    "weight" DECIMAL(10,3),
    "weight_unit" VARCHAR(2) NOT NULL DEFAULT 'kg',
    "package_length" DECIMAL(10,2),
    "package_width" DECIMAL(10,2),
    "package_height" DECIMAL(10,2),
    "dimension_unit" VARCHAR(2) NOT NULL DEFAULT 'cm',
    "options" JSONB NOT NULL DEFAULT '[]',
    "seo_title" VARCHAR(160),
    "seo_description" VARCHAR(320),
    "rating_avg" DECIMAL(3,2),
    "rating_count" INTEGER NOT NULL DEFAULT 0,
    "department_id" INTEGER NOT NULL,
    "category_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_images" (
    "id" SERIAL NOT NULL,
    "product_id" VARCHAR(120) NOT NULL,
    "key" VARCHAR(200) NOT NULL,
    "src" VARCHAR(2000) NOT NULL,
    "credit" VARCHAR(200) NOT NULL DEFAULT '',
    "credit_href" VARCHAR(2000) NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variants" (
    "id" VARCHAR(64) NOT NULL,
    "product_id" VARCHAR(120) NOT NULL,
    "color" VARCHAR(60),
    "size" VARCHAR(60),
    "swatch" VARCHAR(40),
    "options" JSONB NOT NULL DEFAULT '{}',
    "price_cents" INTEGER NOT NULL,
    "inventory" INTEGER,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posts" (
    "id" SERIAL NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "category" VARCHAR(60) NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'published',
    "published_at" TIMESTAMPTZ(3),
    "read" VARCHAR(40) NOT NULL,
    "author" VARCHAR(80) NOT NULL,
    "excerpt" VARCHAR(600) NOT NULL,
    "image" JSONB NOT NULL,
    "body" JSONB NOT NULL,
    "seo_title" VARCHAR(160),
    "seo_description" VARCHAR(320),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carts" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER,
    "visitor_id" VARCHAR(64),
    "discount_code" VARCHAR(64),
    "email" VARCHAR(254),
    "locale" VARCHAR(10),
    "reminder_sent_at" TIMESTAMPTZ(3),
    "dismissed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_lines" (
    "id" SERIAL NOT NULL,
    "cart_id" INTEGER NOT NULL,
    "product_id" VARCHAR(120) NOT NULL,
    "variant_id" VARCHAR(64) NOT NULL,
    "qty" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cart_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wishlist_items" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER,
    "visitor_id" VARCHAR(64),
    "product_id" VARCHAR(120) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wishlist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discounts" (
    "id" SERIAL NOT NULL,
    "method" VARCHAR(10) NOT NULL DEFAULT 'code',
    "name" VARCHAR(120) NOT NULL DEFAULT '',
    "code" VARCHAR(64),
    "code_type" VARCHAR(10) NOT NULL DEFAULT 'shared',
    "kind" VARCHAR(10) NOT NULL,
    "percent_off" DECIMAL(5,2),
    "amount_cents" INTEGER,
    "max_amount_cents" INTEGER,
    "buy_qty" INTEGER,
    "get_qty" INTEGER,
    "get_percent" INTEGER,
    "scope" VARCHAR(12) NOT NULL DEFAULT 'order',
    "product_ids" VARCHAR(120)[] DEFAULT ARRAY[]::VARCHAR(120)[],
    "category_ids" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "department_ids" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "label" VARCHAR(120) NOT NULL,
    "minimum_cents" INTEGER NOT NULL DEFAULT 0,
    "minimum_qty" INTEGER,
    "eligibility" VARCHAR(12) NOT NULL DEFAULT 'everyone',
    "customer_ids" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "per_customer_limit" INTEGER,
    "combinable" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "note" VARCHAR(300) NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "starts_at" TIMESTAMPTZ(3),
    "ends_at" TIMESTAMPTZ(3),
    "usage_limit" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "discounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discount_codes" (
    "id" SERIAL NOT NULL,
    "discount_id" INTEGER NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "order_id" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "discount_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discount_redemptions" (
    "id" SERIAL NOT NULL,
    "discount_id" INTEGER NOT NULL,
    "order_id" INTEGER NOT NULL,
    "user_id" INTEGER,
    "email" VARCHAR(254) NOT NULL,
    "code" VARCHAR(64),
    "label" VARCHAR(200),
    "free_shipping" BOOLEAN,
    "amount_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discount_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "store_name" VARCHAR(80) NOT NULL DEFAULT 'VAREL',
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "tax_name" VARCHAR(40) NOT NULL DEFAULT 'VAT',
    "tax_rate" DECIMAL(6,4) NOT NULL DEFAULT 0.25,
    "free_shipping_threshold_cents" INTEGER NOT NULL DEFAULT 15000,
    "announcement" VARCHAR(300) NOT NULL DEFAULT '',
    "support_email" VARCHAR(254) NOT NULL DEFAULT 'care@varel.studio',
    "low_stock_threshold" INTEGER NOT NULL DEFAULT 6,
    "return_window_days" INTEGER NOT NULL DEFAULT 30,
    "prices_include_tax" BOOLEAN NOT NULL DEFAULT false,
    "tax_digital" BOOLEAN NOT NULL DEFAULT true,
    "tax_shipping" BOOLEAN NOT NULL DEFAULT false,
    "legal_name" VARCHAR(160) NOT NULL DEFAULT '',
    "vat_number" VARCHAR(40) NOT NULL DEFAULT '',
    "business_address" VARCHAR(500) NOT NULL DEFAULT '',
    "phone" VARCHAR(40) NOT NULL DEFAULT '',
    "logo_url" VARCHAR(2000),
    "social_links" JSONB NOT NULL DEFAULT '{}',
    "order_prefix" VARCHAR(10) NOT NULL DEFAULT 'VRL-',
    "guest_checkout" BOOLEAN NOT NULL DEFAULT true,
    "require_phone" BOOLEAN NOT NULL DEFAULT false,
    "order_notes" BOOLEAN NOT NULL DEFAULT false,
    "terms_text" VARCHAR(2000) NOT NULL DEFAULT '',
    "hide_sold_out" BOOLEAN NOT NULL DEFAULT false,
    "return_reasons" VARCHAR(120)[] DEFAULT ARRAY[]::VARCHAR(120)[],
    "refund_shipping" BOOLEAN NOT NULL DEFAULT false,
    "payment_provider" VARCHAR(20) NOT NULL DEFAULT 'simulated',
    "stripe_publishable_key" VARCHAR(255),
    "email_provider" VARCHAR(20) NOT NULL DEFAULT 'outbox',
    "email_config" JSONB NOT NULL DEFAULT '{}',
    "email_from_name" VARCHAR(80) NOT NULL DEFAULT 'VAREL',
    "email_from_address" VARCHAR(254) NOT NULL DEFAULT 'care@varel.studio',
    "email_reply_to" VARCHAR(254),
    "staff_alert_email" VARCHAR(254),
    "seo_title" VARCHAR(160) NOT NULL DEFAULT '',
    "seo_description" VARCHAR(320) NOT NULL DEFAULT '',
    "og_image" VARCHAR(2000),
    "home_hero" JSONB NOT NULL DEFAULT '{}',
    "cookie_consent" BOOLEAN NOT NULL DEFAULT true,
    "abandoned_cart_enabled" BOOLEAN NOT NULL DEFAULT false,
    "abandoned_cart_hours" INTEGER NOT NULL DEFAULT 24,
    "reviews_enabled" BOOLEAN NOT NULL DEFAULT true,
    "reviews_require_approval" BOOLEAN NOT NULL DEFAULT true,
    "reviews_verified_only" BOOLEAN NOT NULL DEFAULT false,
    "analytics_enabled" BOOLEAN NOT NULL DEFAULT true,
    "default_locale" VARCHAR(10) NOT NULL DEFAULT 'en',
    "locales" VARCHAR(10)[] DEFAULT ARRAY['en', 'da', 'de', 'fr', 'es', 'sv']::VARCHAR(10)[],
    "translation_provider" VARCHAR(20) NOT NULL DEFAULT 'workers-ai',
    "auto_translate" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_zones" (
    "id" VARCHAR(80) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "countries" VARCHAR(80)[] DEFAULT ARRAY[]::VARCHAR(80)[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shipping_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_methods" (
    "id" VARCHAR(160) NOT NULL,
    "zone_id" VARCHAR(80) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "detail" VARCHAR(80) NOT NULL DEFAULT '',
    "rate_cents" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shipping_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_rates" (
    "id" SERIAL NOT NULL,
    "country" VARCHAR(80) NOT NULL,
    "rate" DECIMAL(6,4) NOT NULL,
    "name" VARCHAR(40) NOT NULL DEFAULT 'VAT',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tax_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_orders" (
    "id" SERIAL NOT NULL,
    "number" VARCHAR(20) NOT NULL,
    "user_id" INTEGER,
    "email" VARCHAR(254) NOT NULL,
    "phone" VARCHAR(40),
    "payment" VARCHAR(10) NOT NULL DEFAULT 'Paid',
    "fulfillment" VARCHAR(12) NOT NULL DEFAULT 'Unfulfilled',
    "stage" INTEGER NOT NULL DEFAULT 1,
    "carrier" VARCHAR(80),
    "tracking" VARCHAR(120),
    "tracking_url" VARCHAR(2000),
    "method" VARCHAR(200) NOT NULL,
    "address" JSONB,
    "billing_same_as_shipping" BOOLEAN NOT NULL DEFAULT true,
    "billing_address" JSONB,
    "card_brand" VARCHAR(20),
    "card_last4" VARCHAR(4),
    "subtotal_cents" INTEGER NOT NULL,
    "discount_code" VARCHAR(64),
    "discount_id" INTEGER,
    "released_discounts" JSONB,
    "discount_cents" INTEGER NOT NULL DEFAULT 0,
    "shipping_cents" INTEGER NOT NULL DEFAULT 0,
    "tax_cents" INTEGER NOT NULL DEFAULT 0,
    "total_cents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "locale" VARCHAR(10) NOT NULL DEFAULT 'en',
    "prices_include_tax" BOOLEAN NOT NULL DEFAULT false,
    "tax_rate" DECIMAL(6,4),
    "customer_note" VARCHAR(500),
    "payment_provider" VARCHAR(20) NOT NULL DEFAULT 'simulated',
    "note" VARCHAR(2000),
    "placed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shop_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_order_items" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "product_id" VARCHAR(120),
    "name" VARCHAR(160) NOT NULL,
    "category" VARCHAR(80) NOT NULL,
    "sku" VARCHAR(64) NOT NULL,
    "color" VARCHAR(60),
    "size" VARCHAR(60),
    "options" JSONB NOT NULL DEFAULT '{}',
    "qty" INTEGER NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "discount_cents" INTEGER NOT NULL DEFAULT 0,
    "digital" BOOLEAN NOT NULL DEFAULT false,
    "image" JSONB NOT NULL,
    "download" VARCHAR(200),
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shop_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_order_events" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "message" VARCHAR(2000) NOT NULL,
    "by" VARCHAR(120),
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shop_order_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_requests" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'Requested',
    "items" JSONB NOT NULL,
    "note" VARCHAR(2000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "return_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_payments" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "provider" VARCHAR(20) NOT NULL,
    "provider_ref" VARCHAR(255),
    "status" VARCHAR(20) NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "refunded_cents" INTEGER NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "card_brand" VARCHAR(20),
    "card_last4" VARCHAR(4),
    "failure_message" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shop_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "newsletter_subscribers" (
    "id" SERIAL NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "source" VARCHAR(40),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "newsletter_subscribers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_messages" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "subject" VARCHAR(200) NOT NULL,
    "order_number" VARCHAR(20),
    "message" VARCHAR(5000) NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "contact_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collections" (
    "id" SERIAL NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "description" VARCHAR(10000) NOT NULL DEFAULT '',
    "image" JSONB,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "featured_on_home" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "seo_title" VARCHAR(160),
    "seo_description" VARCHAR(320),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_products" (
    "collection_id" INTEGER NOT NULL,
    "product_id" VARCHAR(120) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "collection_products_pkey" PRIMARY KEY ("collection_id","product_id")
);

-- CreateTable
CREATE TABLE "pages" (
    "id" SERIAL NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "body" JSONB NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "seo_title" VARCHAR(160),
    "seo_description" VARCHAR(320),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menus" (
    "id" SERIAL NOT NULL,
    "key" VARCHAR(40) NOT NULL,
    "title" VARCHAR(60) NOT NULL,
    "items" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "menus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" BIGSERIAL NOT NULL,
    "user_id" INTEGER,
    "actor_name" VARCHAR(120) NOT NULL,
    "action" VARCHAR(60) NOT NULL,
    "entity" VARCHAR(40) NOT NULL,
    "entity_id" VARCHAR(120),
    "summary" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_templates" (
    "key" VARCHAR(60) NOT NULL,
    "subject" VARCHAR(200) NOT NULL,
    "body" VARCHAR(20000) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "email_templates_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "email_messages" (
    "id" SERIAL NOT NULL,
    "template" VARCHAR(60),
    "to" VARCHAR(254) NOT NULL,
    "subject" VARCHAR(300) NOT NULL,
    "html" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "provider" VARCHAR(20) NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'queued',
    "error" VARCHAR(2000),
    "provider_id" VARCHAR(255),
    "related_type" VARCHAR(40),
    "related_id" VARCHAR(60),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(3),

    CONSTRAINT "email_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" SERIAL NOT NULL,
    "product_id" VARCHAR(120) NOT NULL,
    "user_id" INTEGER,
    "name" VARCHAR(80) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "rating" INTEGER NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "body" VARCHAR(5000) NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'pending',
    "verified_purchase" BOOLEAN NOT NULL DEFAULT false,
    "reply" VARCHAR(2000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_events" (
    "id" BIGSERIAL NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "session_id" VARCHAR(64),
    "user_id" INTEGER,
    "product_id" VARCHAR(120),
    "order_id" INTEGER,
    "query" VARCHAR(120),
    "results" INTEGER,
    "value_cents" INTEGER,
    "path" VARCHAR(300),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "translations" (
    "id" SERIAL NOT NULL,
    "entity" VARCHAR(32) NOT NULL,
    "entity_id" VARCHAR(120) NOT NULL,
    "field" VARCHAR(60) NOT NULL,
    "locale" VARCHAR(10) NOT NULL,
    "value" TEXT NOT NULL,
    "source" VARCHAR(10) NOT NULL DEFAULT 'auto',
    "source_hash" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "translations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_profiles_user_id_key" ON "customer_profiles"("user_id");

-- CreateIndex
CREATE INDEX "visitors_last_seen_at_idx" ON "visitors"("last_seen_at");

-- CreateIndex
CREATE INDEX "addresses_user_id_id_idx" ON "addresses"("user_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "departments_slug_key" ON "departments"("slug");

-- CreateIndex
CREATE INDEX "categories_slug_idx" ON "categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "categories_department_id_slug_key" ON "categories"("department_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");

-- CreateIndex
CREATE INDEX "products_status_position_id_idx" ON "products"("status", "position", "id");

-- CreateIndex
CREATE INDEX "products_department_id_status_position_idx" ON "products"("department_id", "status", "position");

-- CreateIndex
CREATE INDEX "products_category_id_status_category_position_idx" ON "products"("category_id", "status", "category_position");

-- CreateIndex
CREATE INDEX "products_featured_status_position_idx" ON "products"("featured", "status", "position");

-- CreateIndex
CREATE INDEX "products_name_trgm_idx" ON "products" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "products_brand_trgm_idx" ON "products" USING GIN ("brand" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "products_short_trgm_idx" ON "products" USING GIN ("short" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "product_images_product_id_position_idx" ON "product_images"("product_id", "position");

-- CreateIndex
CREATE INDEX "variants_product_id_position_idx" ON "variants"("product_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "posts_slug_key" ON "posts"("slug");

-- CreateIndex
CREATE INDEX "posts_status_published_at_id_idx" ON "posts"("status", "published_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "posts_category_status_published_at_idx" ON "posts"("category", "status", "published_at" DESC);

-- CreateIndex
CREATE INDEX "posts_title_trgm_idx" ON "posts" USING GIN ("title" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "posts_excerpt_trgm_idx" ON "posts" USING GIN ("excerpt" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "carts_user_id_key" ON "carts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "carts_visitor_id_key" ON "carts"("visitor_id");

-- CreateIndex
CREATE INDEX "carts_updated_at_id_idx" ON "carts"("updated_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "cart_lines_product_id_idx" ON "cart_lines"("product_id");

-- CreateIndex
CREATE INDEX "cart_lines_variant_id_idx" ON "cart_lines"("variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "cart_lines_cart_id_variant_id_key" ON "cart_lines"("cart_id", "variant_id");

-- CreateIndex
CREATE INDEX "wishlist_items_product_id_idx" ON "wishlist_items"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "wishlist_items_user_id_product_id_key" ON "wishlist_items"("user_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "wishlist_items_visitor_id_product_id_key" ON "wishlist_items"("visitor_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "discounts_code_key" ON "discounts"("code");

-- CreateIndex
CREATE INDEX "discounts_method_active_idx" ON "discounts"("method", "active");

-- CreateIndex
CREATE INDEX "discounts_created_at_id_idx" ON "discounts"("created_at" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "discount_codes_code_key" ON "discount_codes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "discount_codes_order_id_key" ON "discount_codes"("order_id");

-- CreateIndex
CREATE INDEX "discount_codes_discount_id_used_at_idx" ON "discount_codes"("discount_id", "used_at");

-- CreateIndex
CREATE INDEX "discount_redemptions_discount_id_created_at_idx" ON "discount_redemptions"("discount_id", "created_at");

-- CreateIndex
CREATE INDEX "discount_redemptions_order_id_idx" ON "discount_redemptions"("order_id");

-- CreateIndex
CREATE INDEX "discount_redemptions_user_id_idx" ON "discount_redemptions"("user_id");

-- CreateIndex
CREATE INDEX "discount_redemptions_email_idx" ON "discount_redemptions"("email");

-- CreateIndex
CREATE UNIQUE INDEX "discount_redemptions_discount_id_order_id_key" ON "discount_redemptions"("discount_id", "order_id");

-- CreateIndex
CREATE INDEX "shipping_methods_zone_id_position_idx" ON "shipping_methods"("zone_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "tax_rates_country_key" ON "tax_rates"("country");

-- CreateIndex
CREATE UNIQUE INDEX "shop_orders_number_key" ON "shop_orders"("number");

-- CreateIndex
CREATE INDEX "shop_orders_user_id_placed_at_id_idx" ON "shop_orders"("user_id", "placed_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "shop_orders_email_placed_at_idx" ON "shop_orders"("email", "placed_at" DESC);

-- CreateIndex
CREATE INDEX "shop_orders_placed_at_id_idx" ON "shop_orders"("placed_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "shop_orders_fulfillment_payment_placed_at_idx" ON "shop_orders"("fulfillment", "payment", "placed_at" DESC);

-- CreateIndex
CREATE INDEX "shop_orders_payment_placed_at_idx" ON "shop_orders"("payment", "placed_at" DESC);

-- CreateIndex
CREATE INDEX "shop_orders_discount_id_idx" ON "shop_orders"("discount_id");

-- CreateIndex
CREATE INDEX "shop_order_items_order_id_position_idx" ON "shop_order_items"("order_id", "position");

-- CreateIndex
CREATE INDEX "shop_order_items_product_id_idx" ON "shop_order_items"("product_id");

-- CreateIndex
CREATE INDEX "shop_order_events_order_id_at_idx" ON "shop_order_events"("order_id", "at");

-- CreateIndex
CREATE INDEX "return_requests_order_id_idx" ON "return_requests"("order_id");

-- CreateIndex
CREATE INDEX "return_requests_status_created_at_idx" ON "return_requests"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "return_requests_created_at_id_idx" ON "return_requests"("created_at" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "shop_payments_provider_ref_key" ON "shop_payments"("provider_ref");

-- CreateIndex
CREATE INDEX "shop_payments_order_id_created_at_idx" ON "shop_payments"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "shop_payments_status_created_at_idx" ON "shop_payments"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "newsletter_subscribers_email_key" ON "newsletter_subscribers"("email");

-- CreateIndex
CREATE INDEX "newsletter_subscribers_created_at_id_idx" ON "newsletter_subscribers"("created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "contact_messages_archived_read_created_at_idx" ON "contact_messages"("archived", "read", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "collections_slug_key" ON "collections"("slug");

-- CreateIndex
CREATE INDEX "collections_published_position_idx" ON "collections"("published", "position");

-- CreateIndex
CREATE INDEX "collection_products_product_id_idx" ON "collection_products"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "pages_slug_key" ON "pages"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "menus_key_key" ON "menus"("key");

-- CreateIndex
CREATE INDEX "activity_logs_created_at_id_idx" ON "activity_logs"("created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "activity_logs_entity_entity_id_idx" ON "activity_logs"("entity", "entity_id");

-- CreateIndex
CREATE INDEX "activity_logs_user_id_id_idx" ON "activity_logs"("user_id", "id");

-- CreateIndex
CREATE INDEX "email_messages_created_at_id_idx" ON "email_messages"("created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "email_messages_to_idx" ON "email_messages"("to");

-- CreateIndex
CREATE INDEX "email_messages_related_type_related_id_idx" ON "email_messages"("related_type", "related_id");

-- CreateIndex
CREATE INDEX "email_messages_status_created_at_idx" ON "email_messages"("status", "created_at");

-- CreateIndex
CREATE INDEX "reviews_product_id_status_created_at_idx" ON "reviews"("product_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "reviews_status_created_at_idx" ON "reviews"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "reviews_user_id_idx" ON "reviews"("user_id");

-- CreateIndex
CREATE INDEX "analytics_events_type_created_at_idx" ON "analytics_events"("type", "created_at");

-- CreateIndex
CREATE INDEX "analytics_events_product_id_type_idx" ON "analytics_events"("product_id", "type");

-- CreateIndex
CREATE INDEX "translations_entity_locale_idx" ON "translations"("entity", "locale");

-- CreateIndex
CREATE INDEX "translations_locale_source_idx" ON "translations"("locale", "source");

-- CreateIndex
CREATE UNIQUE INDEX "translations_entity_entity_id_field_locale_key" ON "translations"("entity", "entity_id", "field", "locale");

-- AddForeignKey
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variants" ADD CONSTRAINT "variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_visitor_id_fkey" FOREIGN KEY ("visitor_id") REFERENCES "visitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_lines" ADD CONSTRAINT "cart_lines_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_lines" ADD CONSTRAINT "cart_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_lines" ADD CONSTRAINT "cart_lines_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_visitor_id_fkey" FOREIGN KEY ("visitor_id") REFERENCES "visitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_codes" ADD CONSTRAINT "discount_codes_discount_id_fkey" FOREIGN KEY ("discount_id") REFERENCES "discounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_codes" ADD CONSTRAINT "discount_codes_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "shop_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_redemptions" ADD CONSTRAINT "discount_redemptions_discount_id_fkey" FOREIGN KEY ("discount_id") REFERENCES "discounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_redemptions" ADD CONSTRAINT "discount_redemptions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "shop_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_redemptions" ADD CONSTRAINT "discount_redemptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_methods" ADD CONSTRAINT "shipping_methods_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "shipping_zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_orders" ADD CONSTRAINT "shop_orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_orders" ADD CONSTRAINT "shop_orders_discount_id_fkey" FOREIGN KEY ("discount_id") REFERENCES "discounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_order_items" ADD CONSTRAINT "shop_order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "shop_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_order_items" ADD CONSTRAINT "shop_order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_order_events" ADD CONSTRAINT "shop_order_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "shop_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "shop_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_payments" ADD CONSTRAINT "shop_payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "shop_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_products" ADD CONSTRAINT "collection_products_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_products" ADD CONSTRAINT "collection_products_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------- CHECK constraints
-- Small fixed sets are VARCHAR + CHECK (docs/agent/database.md); values keep VAREL's spelling.
ALTER TABLE "products" ADD CONSTRAINT "products_type_check" CHECK ("type" IN ('physical', 'digital'));
ALTER TABLE "products" ADD CONSTRAINT "products_status_check" CHECK ("status" IN ('draft', 'published', 'archived'));
ALTER TABLE "products" ADD CONSTRAINT "products_weight_unit_check" CHECK ("weight_unit" IN ('kg', 'g', 'lb', 'oz'));
ALTER TABLE "products" ADD CONSTRAINT "products_dimension_unit_check" CHECK ("dimension_unit" IN ('cm', 'in'));
ALTER TABLE "products" ADD CONSTRAINT "products_money_check"
  CHECK ("price_cents" >= 0 AND ("compare_at_cents" IS NULL OR "compare_at_cents" >= 0) AND ("cost_cents" IS NULL OR "cost_cents" >= 0));
ALTER TABLE "products" ADD CONSTRAINT "products_rating_check"
  CHECK ("rating_count" >= 0 AND ("rating_avg" IS NULL OR "rating_avg" BETWEEN 0 AND 5));
ALTER TABLE "variants" ADD CONSTRAINT "variants_price_check" CHECK ("price_cents" >= 0);
ALTER TABLE "posts" ADD CONSTRAINT "posts_status_check" CHECK ("status" IN ('draft', 'published'));
ALTER TABLE "cart_lines" ADD CONSTRAINT "cart_lines_qty_check" CHECK ("qty" > 0);
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_method_check" CHECK ("method" IN ('code', 'automatic'));
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_code_type_check" CHECK ("code_type" IN ('shared', 'unique'));
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_kind_check" CHECK ("kind" IN ('percent', 'fixed', 'shipping', 'bxgy'));
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_scope_check" CHECK ("scope" IN ('order', 'products', 'categories', 'departments'));
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_eligibility_check"
  CHECK ("eligibility" IN ('everyone', 'signed_in', 'first_order', 'subscribers', 'customers'));
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_values_check"
  CHECK (("percent_off" IS NULL OR "percent_off" BETWEEN 0 AND 100)
     AND ("amount_cents" IS NULL OR "amount_cents" >= 0)
     AND ("max_amount_cents" IS NULL OR "max_amount_cents" >= 0)
     AND "minimum_cents" >= 0
     AND ("get_percent" IS NULL OR "get_percent" BETWEEN 0 AND 100));
ALTER TABLE "discount_redemptions" ADD CONSTRAINT "discount_redemptions_amount_check" CHECK ("amount_cents" >= 0);
ALTER TABLE "settings" ADD CONSTRAINT "settings_singleton_check" CHECK ("id" = 1);
ALTER TABLE "settings" ADD CONSTRAINT "settings_payment_provider_check" CHECK ("payment_provider" IN ('simulated', 'stripe'));
ALTER TABLE "settings" ADD CONSTRAINT "settings_email_provider_check"
  CHECK ("email_provider" IN ('outbox', 'resend', 'postmark', 'ezystudio', 'webhook'));
ALTER TABLE "settings" ADD CONSTRAINT "settings_translation_provider_check"
  CHECK ("translation_provider" IN ('workers-ai', 'deepl', 'none'));
ALTER TABLE "settings" ADD CONSTRAINT "settings_money_check" CHECK ("free_shipping_threshold_cents" >= 0 AND "tax_rate" BETWEEN 0 AND 1);
ALTER TABLE "shipping_methods" ADD CONSTRAINT "shipping_methods_rate_check" CHECK ("rate_cents" >= 0);
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_rate_check" CHECK ("rate" BETWEEN 0 AND 1);
ALTER TABLE "shop_orders" ADD CONSTRAINT "shop_orders_payment_check" CHECK ("payment" IN ('Paid', 'Pending', 'Refunded', 'Failed'));
ALTER TABLE "shop_orders" ADD CONSTRAINT "shop_orders_fulfillment_check"
  CHECK ("fulfillment" IN ('Unfulfilled', 'Processing', 'Shipped', 'Delivered', 'Returned', 'Cancelled'));
ALTER TABLE "shop_orders" ADD CONSTRAINT "shop_orders_payment_provider_check" CHECK ("payment_provider" IN ('simulated', 'stripe'));
ALTER TABLE "shop_orders" ADD CONSTRAINT "shop_orders_money_check"
  CHECK ("subtotal_cents" >= 0 AND "discount_cents" >= 0 AND "shipping_cents" >= 0 AND "tax_cents" >= 0 AND "total_cents" >= 0);
ALTER TABLE "shop_order_items" ADD CONSTRAINT "shop_order_items_check" CHECK ("qty" > 0 AND "price_cents" >= 0 AND "discount_cents" >= 0);
ALTER TABLE "shop_order_events" ADD CONSTRAINT "shop_order_events_kind_check"
  CHECK ("kind" IN ('placed', 'status', 'tracking', 'refund', 'note', 'return'));
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_status_check"
  CHECK ("status" IN ('Requested', 'Approved', 'Rejected', 'Received', 'Refunded'));
ALTER TABLE "shop_payments" ADD CONSTRAINT "shop_payments_provider_check" CHECK ("provider" IN ('simulated', 'stripe'));
ALTER TABLE "shop_payments" ADD CONSTRAINT "shop_payments_status_check"
  CHECK ("status" IN ('requires_payment', 'succeeded', 'failed', 'canceled', 'refunded', 'partially_refunded'));
ALTER TABLE "shop_payments" ADD CONSTRAINT "shop_payments_money_check" CHECK ("amount_cents" >= 0 AND "refunded_cents" >= 0);
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_status_check" CHECK ("status" IN ('queued', 'sent', 'failed', 'stored'));
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_rating_check" CHECK ("rating" BETWEEN 1 AND 5);
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_status_check" CHECK ("status" IN ('pending', 'approved', 'rejected'));
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_type_check"
  CHECK ("type" IN ('page_view', 'product_view', 'add_to_cart', 'checkout_start', 'purchase', 'search'));
ALTER TABLE "translations" ADD CONSTRAINT "translations_source_check" CHECK ("source" IN ('auto', 'manual'));

-- ---------------------------------------------------------------- partial indexes (not in the Prisma schema)
-- Abandoned bags: carts with a captured email, by last change (jobs/abandoned-carts, admin list).
CREATE INDEX "carts_abandoned_idx" ON "carts" ("updated_at" DESC, "id" DESC) WHERE "email" IS NOT NULL;

-- ---------------------------------------------------------------- singletons
-- The store settings row always exists (`id = 1`); its defaults are the schema's.
INSERT INTO "settings" ("id", "updated_at") VALUES (1, CURRENT_TIMESTAMP) ON CONFLICT ("id") DO NOTHING;

COMMIT;
