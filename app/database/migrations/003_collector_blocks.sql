CREATE TABLE collector_blocks (
  chain_id integer NOT NULL, block_number numeric(78,0) NOT NULL, block_hash text NOT NULL,
  canonical boolean NOT NULL DEFAULT true,
  PRIMARY KEY (chain_id,block_number,block_hash)
);
