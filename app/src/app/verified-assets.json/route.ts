import { database } from "@/server/database";

export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const { sql, schema } = database();
    const rows = await sql.query(`SELECT a.chain_id AS "chainId",a.address AS "tokenAddress",a.verified_at AS "verifiedAt",
      coalesce(jsonb_agg(jsonb_build_object('source',s.source_type,'feedAddress',s.oracle_address,'providerId',s.provider_id,'maxStaleness',s.max_age_seconds)) FILTER (WHERE s.id IS NOT NULL),'[]') AS "approvedPricingConfigs"
      FROM ${schema}.assets a LEFT JOIN ${schema}.asset_price_sources s ON s.chain_id=a.chain_id AND s.asset_address=a.address AND s.approved
      WHERE a.verified AND a.enabled GROUP BY a.chain_id,a.address`);
    return Response.json(rows, { headers: { "cache-control": "no-store" } });
  } catch { return Response.json({ error: "REGISTRY_UNAVAILABLE" }, { status: 503 }); }
}
