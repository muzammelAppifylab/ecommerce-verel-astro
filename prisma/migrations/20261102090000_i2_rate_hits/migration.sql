-- I2: per-subject rate limits for the store's public writes (reviews, newsletter, contact, events,
-- returns lookup, guest downloads, account export). One row per counted hit; the subject is an HMAC
-- of the client IP or the account id (never a raw IP or email). Pruned by src/server/lib/rate-limit.ts.
BEGIN;

CREATE TABLE "rate_hits" (
    "id" BIGSERIAL NOT NULL,
    "kind" VARCHAR(24) NOT NULL,
    "subject" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rate_hits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "rate_hits_kind_subject_created_at_idx" ON "rate_hits"("kind", "subject", "created_at");
CREATE INDEX "rate_hits_created_at_idx" ON "rate_hits"("created_at");

COMMIT;
