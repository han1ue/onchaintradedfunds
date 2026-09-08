CREATE FUNCTION require_collector_lease(job_name text, token text) RETURNS void LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE valid boolean;
BEGIN
  SELECT lease_token=token AND lease_until>clock_timestamp() INTO valid
    FROM collector_progress WHERE job=job_name FOR UPDATE;
  IF valid IS DISTINCT FROM true THEN RAISE EXCEPTION 'COLLECTOR_LEASE_EXPIRED'; END IF;
END $$;
-- statement-breakpoint
CREATE TABLE price_source_status (
  source_id text PRIMARY KEY REFERENCES asset_price_sources(id),
  attempted_at timestamptz NOT NULL DEFAULT clock_timestamp(), last_error text
);
