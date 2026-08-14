CREATE OR REPLACE FUNCTION "enforce_ballot_distribution"() RETURNS trigger AS $$
DECLARE
  target_ballot_id uuid;
  total_votes integer;
BEGIN
  target_ballot_id := COALESCE(NEW.ballot_id, OLD.ballot_id);
  IF NOT EXISTS (SELECT 1 FROM ballots WHERE id = target_ballot_id) THEN
    RETURN NULL;
  END IF;
  SELECT COALESCE(SUM(votes), 0) INTO total_votes FROM ballot_allocations WHERE ballot_id = target_ballot_id;
  IF total_votes <> 100 THEN
    RAISE EXCEPTION 'BALLOT_VOTES_NOT_100';
  END IF;
  IF EXISTS (
    SELECT 1 FROM ballot_allocations ba
    JOIN ballots b ON b.id = ba.ballot_id
    JOIN proposals p ON p.id = ba.proposal_id
    WHERE ba.ballot_id = target_ballot_id
      AND p.competition_id <> b.competition_id
  ) THEN
    RAISE EXCEPTION 'INVALID_BALLOT_ALLOCATION';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
