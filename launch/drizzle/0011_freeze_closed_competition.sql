CREATE FUNCTION "assert_competition_inputs_mutable"("target_competition_id" uuid) RETURNS void AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "competitions"
    WHERE "id" = "target_competition_id"
      AND (
        "ends_at" <= statement_timestamp()
        OR "phase" IN ('auditing', 'final', 'cancelled')
      )
  ) THEN
    RAISE EXCEPTION 'COMPETITION_NOT_OPEN';
  END IF;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE FUNCTION "protect_proposal_inputs_after_close"() RETURNS trigger AS $$
BEGIN
  PERFORM "assert_competition_inputs_mutable"(COALESCE(NEW."competition_id", OLD."competition_id"));
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "proposal_inputs_frozen_after_close"
BEFORE INSERT OR UPDATE OR DELETE ON "proposals"
FOR EACH ROW EXECUTE FUNCTION "protect_proposal_inputs_after_close"();
--> statement-breakpoint
CREATE FUNCTION "protect_proposal_asset_inputs_after_close"() RETURNS trigger AS $$
DECLARE
  target_competition_id uuid;
BEGIN
  SELECT "competition_id" INTO target_competition_id
  FROM "proposals" WHERE "id" = COALESCE(NEW."proposal_id", OLD."proposal_id");
  PERFORM "assert_competition_inputs_mutable"(target_competition_id);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "proposal_asset_inputs_frozen_after_close"
BEFORE INSERT OR UPDATE OR DELETE ON "proposal_assets"
FOR EACH ROW EXECUTE FUNCTION "protect_proposal_asset_inputs_after_close"();
--> statement-breakpoint
CREATE FUNCTION "protect_ballot_inputs_after_close"() RETURNS trigger AS $$
BEGIN
  PERFORM "assert_competition_inputs_mutable"(COALESCE(NEW."competition_id", OLD."competition_id"));
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "ballot_inputs_frozen_after_close"
BEFORE INSERT OR UPDATE OR DELETE ON "ballots"
FOR EACH ROW EXECUTE FUNCTION "protect_ballot_inputs_after_close"();
--> statement-breakpoint
CREATE FUNCTION "protect_ballot_allocation_inputs_after_close"() RETURNS trigger AS $$
DECLARE
  target_competition_id uuid;
BEGIN
  SELECT "competition_id" INTO target_competition_id
  FROM "ballots" WHERE "id" = COALESCE(NEW."ballot_id", OLD."ballot_id");
  PERFORM "assert_competition_inputs_mutable"(target_competition_id);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "ballot_allocation_inputs_frozen_after_close"
BEFORE INSERT OR UPDATE OR DELETE ON "ballot_allocations"
FOR EACH ROW EXECUTE FUNCTION "protect_ballot_allocation_inputs_after_close"();
--> statement-breakpoint
CREATE FUNCTION "protect_vote_tranche_inputs_after_close"() RETURNS trigger AS $$
BEGIN
  PERFORM "assert_competition_inputs_mutable"(COALESCE(NEW."competition_id", OLD."competition_id"));
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "vote_tranche_inputs_frozen_after_close"
BEFORE INSERT OR UPDATE OR DELETE ON "vote_tranches"
FOR EACH ROW EXECUTE FUNCTION "protect_vote_tranche_inputs_after_close"();
