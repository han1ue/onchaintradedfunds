CREATE SCHEMA IF NOT EXISTS otf_shared;
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS otf_shared.provider_limits (
  key_hash text PRIMARY KEY, next_start_ms bigint NOT NULL DEFAULT 0, cooldown_ms bigint NOT NULL DEFAULT 0
);
-- statement-breakpoint
CREATE OR REPLACE FUNCTION otf_shared.provider_slot(key_id text, cooldown_until bigint DEFAULT 0)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE now_ms bigint; next_ms bigint; pause_ms bigint;
BEGIN
  INSERT INTO otf_shared.provider_limits(key_hash) VALUES(key_id) ON CONFLICT DO NOTHING;
  SELECT next_start_ms, cooldown_ms INTO next_ms, pause_ms FROM otf_shared.provider_limits WHERE key_hash=key_id FOR UPDATE;
  now_ms := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  pause_ms := greatest(pause_ms, cooldown_until);
  IF cooldown_until > 0 THEN
    UPDATE otf_shared.provider_limits SET cooldown_ms=pause_ms WHERE key_hash=key_id;
    RETURN greatest(0, pause_ms-now_ms);
  END IF;
  IF greatest(next_ms, pause_ms) > now_ms THEN RETURN greatest(next_ms,pause_ms)-now_ms; END IF;
  UPDATE otf_shared.provider_limits SET next_start_ms=now_ms+210 WHERE key_hash=key_id;
  RETURN 0;
END $$;
