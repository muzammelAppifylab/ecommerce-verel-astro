-- WP-22 · Emails: delivery through the send-email background job, per-template counters.
BEGIN;

-- VAREL writes `skipped` when a template is turned off; F1's CHECK left it out.
ALTER TABLE "email_messages" DROP CONSTRAINT IF EXISTS "email_messages_status_check";
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_status_check" CHECK ("status" IN ('queued', 'sent', 'failed', 'stored', 'skipped'));

-- Per-message reply-to (kept for the job and resends), the job's claim and its attempt count.
ALTER TABLE "email_messages" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "claimed_at" TIMESTAMPTZ(3),
ADD COLUMN "reply_to" VARCHAR(254);

-- Template stats kept on write (no groupBy per request).
ALTER TABLE "email_templates" ADD COLUMN "failed_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "last_sent_at" TIMESTAMPTZ(3),
ADD COLUMN "sent_count" INTEGER NOT NULL DEFAULT 0;

-- The log's template filter.
CREATE INDEX "email_messages_template_created_at_id_idx" ON "email_messages"("template", "created_at" DESC, "id" DESC);

-- One-time backfill of the counters from the messages already there.
UPDATE "email_templates" t
SET "sent_count" = m.sent, "failed_count" = m.failed, "last_sent_at" = m.last_at
FROM (
  SELECT "template",
         count(*) FILTER (WHERE "status" IN ('sent', 'stored'))::int AS sent,
         count(*) FILTER (WHERE "status" = 'failed')::int AS failed,
         max("created_at") AS last_at
  FROM "email_messages"
  WHERE "template" IS NOT NULL
  GROUP BY "template"
) m
WHERE m."template" = t."key";

COMMIT;
