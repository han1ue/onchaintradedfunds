ALTER TABLE "proposals" ADD COLUMN "draft_allocations" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "proposals" p
SET "draft_allocations" = staged.allocations
FROM (
  SELECT pa.proposal_id, jsonb_agg(jsonb_build_object(
    'assetId', pa.asset_id::text,
    'pricingConfig', CASE pa.pricing_source
      WHEN 'chainlink-direct' THEN jsonb_build_object('source', pa.pricing_source, 'feedAddress', pa.primary_address)
      WHEN 'chainlink-weth' THEN jsonb_build_object('source', pa.pricing_source, 'assetWethFeedAddress', pa.primary_address, 'wethUsdFeedAddress', pa.secondary_address)
      WHEN 'uniswap-v3' THEN jsonb_build_object('source', pa.pricing_source, 'poolAddress', pa.primary_address)
      ELSE NULL
    END,
    'weightBps', pa.weight_bps
  ) ORDER BY pa.position) AS allocations
  FROM "proposal_assets" pa
  JOIN "proposals" draft ON draft.id = pa.proposal_id AND draft.status = 'draft'
  GROUP BY pa.proposal_id
) staged
WHERE p.id = staged.proposal_id;--> statement-breakpoint
DELETE FROM "proposal_assets" pa
USING "proposals" p
WHERE p.id = pa.proposal_id AND p.status = 'draft';
