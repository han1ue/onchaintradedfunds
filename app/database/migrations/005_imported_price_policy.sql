SELECT set_config('otf.actor','validated-import-price-policy',true);
-- statement-breakpoint
UPDATE asset_price_sources s SET approved=false,
  validation_metadata=s.validation_metadata || '{"validationFailure":"MOCK_ORACLE_NOT_STOCK_REFERENCE"}'::jsonb
FROM assets a WHERE s.chain_id=46630 AND s.chain_id=a.chain_id AND s.asset_address=a.address
  AND s.source_type='chainlink' AND s.validated_at IS NULL
  AND s.validation_metadata->>'expectedDescription'=a.symbol || ' / USD'
  AND a.address IN ('0x1fbe1a0e43594b3455993b5de5fd0a7a266298d0','0x3b8262a63d25f0477c4dde23f83cfe22cb768c93','0x5884ad2f920c162cfbbacc88c9c51aa75ec09e02','0x71178bac73cbeb415514eb542a8995b82669778d','0xc9f9c86933092bbbfff3ccb4b105a4a94bf3bd4e');
-- statement-breakpoint
UPDATE asset_price_sources SET validation_metadata=validation_metadata || '{"marketClosedMaxAgeSeconds":345600}'::jsonb
WHERE source_type='yahoo' AND NOT validation_metadata ? 'marketClosedMaxAgeSeconds';
