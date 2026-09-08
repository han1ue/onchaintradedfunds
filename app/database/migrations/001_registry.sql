CREATE TABLE assets (
  chain_id integer NOT NULL CHECK (chain_id > 0),
  address text NOT NULL CHECK (address ~ '^0x[0-9a-f]{40}$'),
  slug text NOT NULL, symbol text NOT NULL, name text NOT NULL,
  decimals smallint NOT NULL CHECK (decimals BETWEEN 0 AND 36),
  asset_type text NOT NULL CHECK (asset_type IN ('stock_token','stablecoin','wrapped_native','protocol_token','fund_share','other')),
  role text CHECK (role IN ('quote','fund')),
  verified boolean NOT NULL DEFAULT false, enabled boolean NOT NULL DEFAULT true,
  verified_at timestamptz, verification_revoked_at timestamptz,
  featured boolean NOT NULL DEFAULT false, metadata jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (chain_id, address)
);
-- statement-breakpoint
CREATE TABLE asset_price_sources (
  id text PRIMARY KEY,
  chain_id integer NOT NULL, asset_address text NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('chainlink','yahoo','otf_launch','fixed')),
  valuation_kind text NOT NULL CHECK (valuation_kind IN ('stock_reference','token_market','executable_quote')),
  oracle_address text CHECK (oracle_address ~ '^0x[0-9a-f]{40}$'), provider_id text,
  priority integer NOT NULL DEFAULT 100 CHECK (priority >= 0),
  max_age_seconds integer NOT NULL CHECK (max_age_seconds > 0),
  approved boolean NOT NULL DEFAULT false, validated_at timestamptz,
  validation_metadata jsonb NOT NULL DEFAULT '{}',
  FOREIGN KEY (chain_id, asset_address) REFERENCES assets(chain_id, address),
  CHECK (oracle_address IS NOT NULL OR provider_id IS NOT NULL)
);
-- statement-breakpoint
CREATE TABLE pools (
  id text PRIMARY KEY, chain_id integer NOT NULL,
  venue text NOT NULL, protocol_version integer NOT NULL CHECK (protocol_version IN (3,4)),
  token0 text NOT NULL, token1 text NOT NULL,
  pool_address text CHECK (pool_address ~ '^0x[0-9a-f]{40}$'),
  pool_manager text CHECK (pool_manager ~ '^0x[0-9a-f]{40}$'),
  pool_id text CHECK (pool_id ~ '^0x[0-9a-f]{64}$'),
  fee integer NOT NULL CHECK (fee BETWEEN 0 AND 8388608),
  tick_spacing integer, hooks text CHECK (hooks ~ '^0x[0-9a-f]{40}$'),
  hook_data text NOT NULL DEFAULT '0x' CHECK (hook_data ~ '^0x([0-9a-f]{2})*$'),
  enabled boolean NOT NULL DEFAULT false, approved boolean NOT NULL DEFAULT false,
  validated_at timestamptz, validation_metadata jsonb NOT NULL DEFAULT '{}',
  FOREIGN KEY (chain_id, token0) REFERENCES assets(chain_id, address),
  FOREIGN KEY (chain_id, token1) REFERENCES assets(chain_id, address),
  CHECK (token0 < token1),
  CHECK ((protocol_version = 3 AND pool_address IS NOT NULL AND pool_id IS NULL AND fee > 0 AND fee < 1000000)
    OR (protocol_version = 4 AND pool_id IS NOT NULL AND pool_manager IS NOT NULL AND tick_spacing > 0 AND hooks IS NOT NULL)),
  UNIQUE (chain_id, venue, pool_address), UNIQUE (chain_id, venue, pool_manager, pool_id)
);
-- statement-breakpoint
CREATE TABLE registry_settings (key text PRIMARY KEY, value jsonb NOT NULL);
-- statement-breakpoint
CREATE TABLE asset_prices (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id text NOT NULL REFERENCES asset_price_sources(id),
  price_usd numeric(96,36) NOT NULL CHECK (price_usd > 0),
  source_at timestamptz NOT NULL, collected_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  block_number numeric(78,0), block_hash text,
  quality text NOT NULL CHECK (quality IN ('fresh','stale','market_closed','invalid')),
  metadata jsonb NOT NULL DEFAULT '{}',
  UNIQUE (source_id, source_at, block_hash),
  CHECK (source_at <= collected_at + interval '30 seconds')
);
-- statement-breakpoint
CREATE INDEX asset_prices_latest ON asset_prices(source_id, source_at DESC, collected_at DESC);
-- statement-breakpoint
CREATE TABLE asset_market_caps (
  chain_id integer NOT NULL, asset_address text NOT NULL,
  market_cap_usd numeric(96,36) NOT NULL CHECK (market_cap_usd > 0),
  source_at timestamptz NOT NULL, collected_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  provider_id text NOT NULL,
  PRIMARY KEY (chain_id, asset_address),
  FOREIGN KEY (chain_id, asset_address) REFERENCES assets(chain_id, address)
);
-- statement-breakpoint
CREATE TABLE funds (
  chain_id integer NOT NULL, address text NOT NULL CHECK (address ~ '^0x[0-9a-f]{40}$'),
  factory text NOT NULL CHECK (factory ~ '^0x[0-9a-f]{40}$'),
  creation_block numeric(78,0) NOT NULL, creation_block_hash text NOT NULL,
  discovery_metadata jsonb NOT NULL DEFAULT '{}', canonical boolean NOT NULL DEFAULT true,
  PRIMARY KEY (chain_id, address)
);
-- statement-breakpoint
CREATE TABLE fund_snapshots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chain_id integer NOT NULL, fund_address text NOT NULL,
  slot_at timestamptz NOT NULL, block_number numeric(78,0) NOT NULL, block_hash text NOT NULL,
  block_at timestamptz NOT NULL, collected_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  total_supply numeric(78,0) NOT NULL CHECK (total_supply >= 0),
  total_nav_usd numeric(96,36), nav_per_share_usd numeric(96,36), bootstrap_nav_usd numeric(96,36),
  status text NOT NULL CHECK (status IN ('ready','bootstrap','unpriced')),
  canonical boolean NOT NULL DEFAULT true, policy_version integer NOT NULL DEFAULT 1,
  FOREIGN KEY (chain_id, fund_address) REFERENCES funds(chain_id, address),
  CHECK ((total_supply = 0 AND nav_per_share_usd IS NULL) OR (total_supply > 0 AND bootstrap_nav_usd IS NULL)),
  UNIQUE (chain_id, fund_address, slot_at, block_hash)
);
-- statement-breakpoint
CREATE UNIQUE INDEX fund_snapshot_slot ON fund_snapshots(chain_id, fund_address, slot_at) WHERE canonical;
-- statement-breakpoint
CREATE TABLE snapshot_holdings (
  snapshot_id bigint NOT NULL REFERENCES fund_snapshots(id) ON DELETE CASCADE,
  asset_address text NOT NULL, decimals smallint NOT NULL,
  accounted_amount numeric(78,0) NOT NULL CHECK (accounted_amount >= 0),
  bootstrap_amount numeric(78,0), price_id bigint REFERENCES asset_prices(id),
  PRIMARY KEY (snapshot_id, asset_address)
);
-- statement-breakpoint
CREATE TABLE collector_progress (
  job text PRIMARY KEY, block_number numeric(78,0), block_hash text,
  lease_token text, lease_until timestamptz, completed_at timestamptz, last_error text
);
-- statement-breakpoint
CREATE TABLE registry_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  actor text NOT NULL, table_name text NOT NULL, operation text NOT NULL,
  before_row jsonb, after_row jsonb, transaction_id bigint NOT NULL
);
-- statement-breakpoint
CREATE FUNCTION audit_registry_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('INSERT INTO %I.registry_audit(actor,table_name,operation,before_row,after_row,transaction_id) VALUES ($1,$2,$3,$4,$5,$6)', TG_TABLE_SCHEMA)
    USING coalesce(nullif(current_setting('otf.actor',true),''),current_user), TG_TABLE_NAME, TG_OP,
      CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
      CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END, txid_current();
  RETURN NULL;
END $$;
-- statement-breakpoint
CREATE TRIGGER assets_audit AFTER INSERT OR UPDATE OR DELETE ON assets FOR EACH ROW EXECUTE FUNCTION audit_registry_change();
-- statement-breakpoint
CREATE TRIGGER sources_audit AFTER INSERT OR UPDATE OR DELETE ON asset_price_sources FOR EACH ROW EXECUTE FUNCTION audit_registry_change();
-- statement-breakpoint
CREATE TRIGGER pools_audit AFTER INSERT OR UPDATE OR DELETE ON pools FOR EACH ROW EXECUTE FUNCTION audit_registry_change();
-- statement-breakpoint
CREATE TRIGGER settings_audit AFTER INSERT OR UPDATE OR DELETE ON registry_settings FOR EACH ROW EXECUTE FUNCTION audit_registry_change();
