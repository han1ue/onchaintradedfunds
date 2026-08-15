ALTER TABLE "ballot_allocations" DROP CONSTRAINT "ballot_allocation_votes_range";--> statement-breakpoint
UPDATE "ballots" b
SET "status" = 'invalid', "invalidated_at" = now(), "updated_at" = now()
WHERE b."status" = 'valid' AND EXISTS (
	SELECT 1 FROM "ballot_allocations" ba
	WHERE ba."ballot_id" = b."id"
	GROUP BY ba."ballot_id"
	HAVING sum(ba."votes") > 12 OR max(ba."votes") > 12
);--> statement-breakpoint
ALTER TABLE "ballot_allocations" ADD CONSTRAINT "ballot_allocation_votes_range" CHECK ("ballot_allocations"."votes" between 1 and 12) NOT VALID;--> statement-breakpoint
UPDATE "competitions"
SET "starts_at" = now() - interval '7 days', "ends_at" = now() + interval '30 days', "updated_at" = now()
WHERE "phase" = 'open';--> statement-breakpoint
UPDATE "competitions"
SET "ends_at" = "starts_at" + interval '37 days', "updated_at" = now()
WHERE "phase" IN ('draft', 'scheduled');
