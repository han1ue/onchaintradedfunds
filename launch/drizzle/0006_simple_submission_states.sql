DROP INDEX IF EXISTS "proposal_one_creator_uq";
DROP INDEX IF EXISTS "proposal_competition_slug_uq";
DROP INDEX IF EXISTS "proposal_competition_name_uq";
DROP INDEX IF EXISTS "proposal_competition_ticker_uq";

ALTER TABLE "proposals" ALTER COLUMN "status" DROP DEFAULT;
CREATE TYPE "public"."proposal_status_next" AS ENUM('draft', 'confirmed', 'deleted');
ALTER TABLE "proposals" ALTER COLUMN "status" TYPE "public"."proposal_status_next" USING (
  CASE "status"::text
    WHEN 'accepted' THEN 'confirmed'
    WHEN 'draft' THEN 'draft'
    WHEN 'posting' THEN 'draft'
    ELSE 'deleted'
  END
)::"public"."proposal_status_next";
DROP TYPE "public"."proposal_status";
ALTER TYPE "public"."proposal_status_next" RENAME TO "proposal_status";
ALTER TABLE "proposals" ALTER COLUMN "status" SET DEFAULT 'draft';

CREATE UNIQUE INDEX "proposal_competition_slug_uq" ON "proposals" USING btree ("competition_id", "slug") WHERE "status" <> 'deleted';
CREATE UNIQUE INDEX "proposal_competition_name_uq" ON "proposals" USING btree ("competition_id", lower("name")) WHERE "status" <> 'deleted';
CREATE UNIQUE INDEX "proposal_competition_ticker_uq" ON "proposals" USING btree ("competition_id", lower("ticker")) WHERE "status" <> 'deleted';
