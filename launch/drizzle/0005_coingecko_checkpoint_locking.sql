ALTER TABLE "price_capture_runs" ADD COLUMN "capture_key" text;
--> statement-breakpoint
UPDATE "price_capture_runs" SET "capture_key" = 'legacy:' || "id"::text WHERE "capture_key" IS NULL;
--> statement-breakpoint
ALTER TABLE "price_capture_runs" ALTER COLUMN "capture_key" SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "price_capture_runs_capture_key_uq" ON "price_capture_runs" USING btree ("capture_key");
