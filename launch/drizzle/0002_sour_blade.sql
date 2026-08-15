ALTER TABLE "competitions" DROP CONSTRAINT "competitions_slug_unique";--> statement-breakpoint
ALTER TABLE "competitions" DROP CONSTRAINT "competition_positive_thresholds";--> statement-breakpoint
ALTER TABLE "competitions" ADD COLUMN "singleton" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "competitions" DROP COLUMN "slug";--> statement-breakpoint
ALTER TABLE "competitions" DROP COLUMN "name";--> statement-breakpoint
ALTER TABLE "competitions" DROP COLUMN "launch_interval_days";--> statement-breakpoint
ALTER TABLE "competitions" DROP COLUMN "min_followers";--> statement-breakpoint
ALTER TABLE "competitions" DROP COLUMN "min_account_age_days";--> statement-breakpoint
ALTER TABLE "competitions" DROP COLUMN "min_assets";--> statement-breakpoint
ALTER TABLE "competitions" DROP COLUMN "min_asset_weight_bps";--> statement-breakpoint
ALTER TABLE "competitions" DROP COLUMN "rule_version";--> statement-breakpoint
ALTER TABLE "competitions" DROP COLUMN "ranking_policy_version";--> statement-breakpoint
DO $$
BEGIN
	IF (SELECT count(*) FROM "competitions") > 1 THEN
		RAISE EXCEPTION 'Singleton competition migration requires exactly one competition row';
	END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "competitions" ADD CONSTRAINT "competitions_singleton_unique" UNIQUE("singleton");--> statement-breakpoint
ALTER TABLE "competitions" ADD CONSTRAINT "competition_singleton" CHECK ("competitions"."singleton" = true);--> statement-breakpoint
CREATE FUNCTION protect_competition_singleton() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'The singleton competition cannot be deleted';
	END IF;
	IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."singleton" IS DISTINCT FROM OLD."singleton" THEN
		RAISE EXCEPTION 'The singleton competition identity is immutable';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "competition_singleton_immutable"
BEFORE UPDATE OR DELETE ON "competitions"
FOR EACH ROW EXECUTE FUNCTION protect_competition_singleton();
