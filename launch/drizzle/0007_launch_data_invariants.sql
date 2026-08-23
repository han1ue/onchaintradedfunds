-- Keep acceptance times authoritative even when a caller supplies its own clock.
CREATE FUNCTION "stamp_confirmed_proposal_acceptance"() RETURNS trigger AS $$
BEGIN
  IF NEW."status" = 'confirmed'
    AND (TG_OP = 'INSERT' OR OLD."status" IS DISTINCT FROM 'confirmed')
  THEN
    NEW."accepted_at" := statement_timestamp();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "confirmed_proposal_acceptance_timestamp"
BEFORE INSERT OR UPDATE ON "proposals"
FOR EACH ROW EXECUTE FUNCTION "stamp_confirmed_proposal_acceptance"();
--> statement-breakpoint
CREATE FUNCTION "stamp_vote_tranche_acceptance"() RETURNS trigger AS $$
BEGIN
  NEW."accepted_at" := statement_timestamp();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "vote_tranche_acceptance_timestamp"
BEFORE INSERT ON "vote_tranches"
FOR EACH ROW EXECUTE FUNCTION "stamp_vote_tranche_acceptance"();
--> statement-breakpoint

CREATE FUNCTION "assert_confirmed_proposal_invariants"("target_proposal_id" uuid) RETURNS void AS $$
DECLARE
  proposal_status proposal_status;
  proposal_accepted_at timestamptz;
  minimum_assets integer;
  minimum_asset_weight_bps integer;
  portfolio_weight_bps integer;
  asset_count integer;
  asset_weight_total bigint;
BEGIN
  -- Serialize direct child-table writes against the same proposal.
  PERFORM 1 FROM "proposals" WHERE "id" = "target_proposal_id" FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT
    p."status",
    p."accepted_at",
    (c."rules"->>'minAssets')::integer,
    (c."rules"->>'minAssetWeightBps')::integer,
    (c."rules"->>'portfolioWeightBps')::integer
  INTO
    proposal_status,
    proposal_accepted_at,
    minimum_assets,
    minimum_asset_weight_bps,
    portfolio_weight_bps
  FROM "proposals" p
  JOIN "competitions" c ON c."id" = p."competition_id"
  WHERE p."id" = "target_proposal_id";

  IF proposal_status <> 'confirmed' THEN RETURN; END IF;
  IF proposal_accepted_at IS NULL THEN
    RAISE EXCEPTION 'CONFIRMED_PROPOSAL_ACCEPTED_AT_REQUIRED';
  END IF;
  IF minimum_assets IS NULL OR minimum_assets < 0
    OR minimum_asset_weight_bps IS NULL OR minimum_asset_weight_bps < 0
    OR portfolio_weight_bps IS NULL OR portfolio_weight_bps < 0
  THEN
    RAISE EXCEPTION 'INVALID_PROPOSAL_COMPETITION_RULES';
  END IF;

  SELECT count(*)::integer, COALESCE(sum(pa."weight_bps"), 0)
  INTO asset_count, asset_weight_total
  FROM "proposal_assets" pa
  WHERE pa."proposal_id" = "target_proposal_id";

  IF asset_count < minimum_assets THEN
    RAISE EXCEPTION 'CONFIRMED_PROPOSAL_ASSET_MINIMUM';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "proposal_assets" pa
    WHERE pa."proposal_id" = "target_proposal_id"
      AND pa."weight_bps" < minimum_asset_weight_bps
  ) THEN
    RAISE EXCEPTION 'CONFIRMED_PROPOSAL_WEIGHT_MINIMUM';
  END IF;
  IF asset_weight_total <> portfolio_weight_bps THEN
    RAISE EXCEPTION 'CONFIRMED_PROPOSAL_WEIGHT_TOTAL';
  END IF;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE FUNCTION "assert_ballot_invariants"("target_ballot_id" uuid) RETURNS void AS $$
DECLARE
  ballot_competition_id uuid;
  ballot_voter_user_id text;
  competition_starts_at timestamptz;
  submission_only_days integer;
  initial_votes integer;
  votes_per_unlock integer;
  vote_unlock_interval_days integer;
  total_votes_rule integer;
  allocation_total bigint;
  cumulative_votes bigint := 0;
  unlocked_votes bigint;
  voting_starts_at timestamptz;
  unlock_interval_seconds double precision;
  tranche record;
BEGIN
  -- Child-only writes still serialize on the ballot before aggregate checks run.
  PERFORM 1 FROM "ballots" WHERE "id" = "target_ballot_id" FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT
    b."competition_id",
    b."voter_user_id",
    c."starts_at",
    (c."rules"->>'submissionOnlyDays')::integer,
    (c."rules"->>'initialVotes')::integer,
    (c."rules"->>'votesPerUnlock')::integer,
    (c."rules"->>'voteUnlockIntervalDays')::integer,
    (c."rules"->>'totalVotes')::integer
  INTO
    ballot_competition_id,
    ballot_voter_user_id,
    competition_starts_at,
    submission_only_days,
    initial_votes,
    votes_per_unlock,
    vote_unlock_interval_days,
    total_votes_rule
  FROM "ballots" b
  JOIN "competitions" c ON c."id" = b."competition_id"
  WHERE b."id" = "target_ballot_id";

  IF submission_only_days IS NULL OR submission_only_days < 0
    OR initial_votes IS NULL OR initial_votes < 0
    OR votes_per_unlock IS NULL OR votes_per_unlock < 0
    OR vote_unlock_interval_days IS NULL OR vote_unlock_interval_days <= 0
    OR total_votes_rule IS NULL OR total_votes_rule < 0
  THEN
    RAISE EXCEPTION 'INVALID_BALLOT_COMPETITION_RULES';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ballot_allocations" ba
    JOIN "proposals" p ON p."id" = ba."proposal_id"
    WHERE ba."ballot_id" = "target_ballot_id"
      AND p."competition_id" IS DISTINCT FROM ballot_competition_id
  ) THEN
    RAISE EXCEPTION 'BALLOT_ALLOCATION_COMPETITION_MISMATCH';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "vote_tranches" vt
    JOIN "proposals" p ON p."id" = vt."proposal_id"
    LEFT JOIN "tweet_evidence" e ON e."id" = vt."evidence_id"
    WHERE vt."ballot_id" = "target_ballot_id"
      AND (
        vt."competition_id" IS DISTINCT FROM ballot_competition_id
        OR vt."voter_user_id" IS DISTINCT FROM ballot_voter_user_id
        OR p."competition_id" IS DISTINCT FROM ballot_competition_id
        OR e."id" IS NULL
        OR e."action" IS DISTINCT FROM 'vote'
        OR e."competition_id" IS DISTINCT FROM ballot_competition_id
        OR e."user_id" IS DISTINCT FROM ballot_voter_user_id
        OR (e."proposal_id" IS NOT NULL AND e."proposal_id" IS DISTINCT FROM vt."proposal_id")
      )
  ) THEN
    RAISE EXCEPTION 'VOTE_TRANCHE_CONTEXT_MISMATCH';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ballot_allocations" ba
    LEFT JOIN (
      SELECT vt."proposal_id", sum(vt."quantity") AS "quantity"
      FROM "vote_tranches" vt
      WHERE vt."ballot_id" = "target_ballot_id"
      GROUP BY vt."proposal_id"
    ) totals ON totals."proposal_id" = ba."proposal_id"
    WHERE ba."ballot_id" = "target_ballot_id"
      AND ba."votes" IS DISTINCT FROM COALESCE(totals."quantity", 0)
  ) OR EXISTS (
    SELECT 1
    FROM "vote_tranches" vt
    WHERE vt."ballot_id" = "target_ballot_id"
      AND NOT EXISTS (
        SELECT 1 FROM "ballot_allocations" ba
        WHERE ba."ballot_id" = vt."ballot_id"
          AND ba."proposal_id" = vt."proposal_id"
      )
  ) THEN
    RAISE EXCEPTION 'BALLOT_ALLOCATION_TRANCHE_MISMATCH';
  END IF;

  SELECT COALESCE(sum(ba."votes"), 0)
  INTO allocation_total
  FROM "ballot_allocations" ba
  WHERE ba."ballot_id" = "target_ballot_id";
  IF allocation_total > total_votes_rule THEN
    RAISE EXCEPTION 'BALLOT_TOTAL_VOTES_EXCEEDED';
  END IF;

  voting_starts_at := competition_starts_at + make_interval(
    secs => (submission_only_days * extract(epoch FROM interval '1 day'))::double precision
  );
  unlock_interval_seconds := vote_unlock_interval_days * extract(epoch FROM interval '1 day');

  FOR tranche IN
    SELECT vt."accepted_at", sum(vt."quantity") AS "quantity"
    FROM "vote_tranches" vt
    WHERE vt."ballot_id" = "target_ballot_id"
    GROUP BY vt."accepted_at"
    ORDER BY vt."accepted_at"
  LOOP
    cumulative_votes := cumulative_votes + tranche."quantity";
    IF tranche."accepted_at" < voting_starts_at THEN
      unlocked_votes := 0;
    ELSE
      unlocked_votes := LEAST(
        total_votes_rule,
        initial_votes
          + floor(extract(epoch FROM (tranche."accepted_at" - voting_starts_at)) / unlock_interval_seconds)::bigint
            * votes_per_unlock
      );
    END IF;
    IF cumulative_votes > unlocked_votes THEN
      RAISE EXCEPTION 'BALLOT_VOTES_NOT_UNLOCKED';
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE FUNCTION "enforce_proposal_invariants"() RETURNS trigger AS $$
DECLARE
  affected_ballot_id uuid;
BEGIN
  IF TG_OP <> 'DELETE' THEN
    PERFORM "assert_confirmed_proposal_invariants"(NEW."id");
    FOR affected_ballot_id IN
      SELECT ba."ballot_id" FROM "ballot_allocations" ba WHERE ba."proposal_id" = NEW."id"
      UNION
      SELECT vt."ballot_id" FROM "vote_tranches" vt WHERE vt."proposal_id" = NEW."id"
    LOOP
      PERFORM "assert_ballot_invariants"(affected_ballot_id);
    END LOOP;
  END IF;
  IF TG_OP <> 'INSERT' AND (TG_OP = 'DELETE' OR OLD."id" IS DISTINCT FROM NEW."id") THEN
    PERFORM "assert_confirmed_proposal_invariants"(OLD."id");
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "proposal_invariants_valid"
AFTER INSERT OR UPDATE OR DELETE ON "proposals"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "enforce_proposal_invariants"();
--> statement-breakpoint

CREATE FUNCTION "enforce_proposal_asset_invariants"() RETURNS trigger AS $$
BEGIN
  IF TG_OP <> 'DELETE' THEN
    PERFORM "assert_confirmed_proposal_invariants"(NEW."proposal_id");
  END IF;
  IF TG_OP <> 'INSERT' AND (TG_OP = 'DELETE' OR OLD."proposal_id" IS DISTINCT FROM NEW."proposal_id") THEN
    PERFORM "assert_confirmed_proposal_invariants"(OLD."proposal_id");
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "proposal_asset_invariants_valid"
AFTER INSERT OR UPDATE OR DELETE ON "proposal_assets"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "enforce_proposal_asset_invariants"();
--> statement-breakpoint

CREATE FUNCTION "enforce_ballot_parent_invariants"() RETURNS trigger AS $$
BEGIN
  IF TG_OP <> 'DELETE' THEN
    PERFORM "assert_ballot_invariants"(NEW."id");
  END IF;
  IF TG_OP <> 'INSERT' AND (TG_OP = 'DELETE' OR OLD."id" IS DISTINCT FROM NEW."id") THEN
    PERFORM "assert_ballot_invariants"(OLD."id");
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "ballot_invariants_valid"
AFTER INSERT OR UPDATE OR DELETE ON "ballots"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "enforce_ballot_parent_invariants"();
--> statement-breakpoint

CREATE FUNCTION "enforce_ballot_allocation_invariants"() RETURNS trigger AS $$
BEGIN
  IF TG_OP <> 'DELETE' THEN
    PERFORM "assert_ballot_invariants"(NEW."ballot_id");
  END IF;
  IF TG_OP <> 'INSERT' AND (TG_OP = 'DELETE' OR OLD."ballot_id" IS DISTINCT FROM NEW."ballot_id") THEN
    PERFORM "assert_ballot_invariants"(OLD."ballot_id");
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER "ballot_distribution_valid" ON "ballot_allocations";
--> statement-breakpoint
DROP FUNCTION "enforce_ballot_distribution"();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "ballot_allocation_invariants_valid"
AFTER INSERT OR UPDATE OR DELETE ON "ballot_allocations"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "enforce_ballot_allocation_invariants"();
--> statement-breakpoint

CREATE FUNCTION "enforce_vote_tranche_invariants"() RETURNS trigger AS $$
BEGIN
  IF TG_OP <> 'DELETE' THEN
    PERFORM "assert_ballot_invariants"(NEW."ballot_id");
  END IF;
  IF TG_OP <> 'INSERT' AND (TG_OP = 'DELETE' OR OLD."ballot_id" IS DISTINCT FROM NEW."ballot_id") THEN
    PERFORM "assert_ballot_invariants"(OLD."ballot_id");
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "vote_tranche_invariants_valid"
AFTER INSERT OR UPDATE OR DELETE ON "vote_tranches"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "enforce_vote_tranche_invariants"();
--> statement-breakpoint

CREATE FUNCTION "enforce_evidence_ballot_invariants"() RETURNS trigger AS $$
DECLARE
  affected_ballot_id uuid;
BEGIN
  FOR affected_ballot_id IN
    SELECT DISTINCT vt."ballot_id"
    FROM "vote_tranches" vt
    WHERE (TG_OP <> 'DELETE' AND vt."evidence_id" = NEW."id")
      OR (TG_OP <> 'INSERT' AND vt."evidence_id" = OLD."id")
  LOOP
    PERFORM "assert_ballot_invariants"(affected_ballot_id);
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "evidence_ballot_invariants_valid"
AFTER INSERT OR UPDATE OR DELETE ON "tweet_evidence"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "enforce_evidence_ballot_invariants"();
--> statement-breakpoint

CREATE FUNCTION "enforce_competition_participation_invariants"() RETURNS trigger AS $$
DECLARE
  affected_proposal_id uuid;
  affected_ballot_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN RETURN NULL; END IF;
  FOR affected_proposal_id IN
    SELECT p."id" FROM "proposals" p WHERE p."competition_id" = NEW."id"
  LOOP
    PERFORM "assert_confirmed_proposal_invariants"(affected_proposal_id);
  END LOOP;
  FOR affected_ballot_id IN
    SELECT b."id" FROM "ballots" b WHERE b."competition_id" = NEW."id"
  LOOP
    PERFORM "assert_ballot_invariants"(affected_ballot_id);
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "competition_participation_invariants_valid"
AFTER INSERT OR UPDATE ON "competitions"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "enforce_competition_participation_invariants"();
--> statement-breakpoint

-- Constraint triggers only observe future writes, so reject migration of any
-- already-invalid launch participation instead of silently grandfathering it.
DO $$
DECLARE
  target_id uuid;
BEGIN
  FOR target_id IN SELECT p."id" FROM "proposals" p LOOP
    PERFORM "assert_confirmed_proposal_invariants"(target_id);
  END LOOP;
  FOR target_id IN SELECT b."id" FROM "ballots" b LOOP
    PERFORM "assert_ballot_invariants"(target_id);
  END LOOP;
END;
$$;
