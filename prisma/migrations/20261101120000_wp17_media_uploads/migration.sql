-- WP-17: images staff upload to platform storage (public files). Additive.
BEGIN;

CREATE TABLE "media_uploads" (
    "id" SERIAL NOT NULL,
    "file_id" VARCHAR(32) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "content_type" VARCHAR(40) NOT NULL,
    "size" INTEGER NOT NULL,
    "url" VARCHAR(400),
    "ready" BOOLEAN NOT NULL DEFAULT false,
    "uploaded_by" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_uploads_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "media_uploads_size_check" CHECK ("size" > 0)
);

CREATE UNIQUE INDEX "media_uploads_file_id_key" ON "media_uploads"("file_id");
CREATE INDEX "media_uploads_uploaded_by_id_idx" ON "media_uploads"("uploaded_by", "id");

COMMIT;
