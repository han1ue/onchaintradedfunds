import { database } from "@/server/database";
import { protocolDeploymentForChain } from "@/lib/deployment";
export const dynamic="force-dynamic";
export async function GET(request:Request) {
  const chainId=Number(new URL(request.url).searchParams.get("chainId"));
  if(![4663,46630].includes(chainId))return Response.json({error:"INVALID_CHAIN_ID"},{status:400});
  try {
    const {sql,schema}=database();
    const rows=await sql.query(`SELECT f.address,s.block_at,s.status,s.total_nav_usd::text,
      (SELECT h.accounted_amount::text FROM ${schema}.snapshot_holdings h WHERE h.snapshot_id=s.id AND h.asset_address=$2) AS otf_balance
      FROM ${schema}.funds f JOIN LATERAL (SELECT * FROM ${schema}.fund_snapshots WHERE chain_id=f.chain_id AND fund_address=f.address AND canonical ORDER BY slot_at DESC LIMIT 1) s ON true
      WHERE f.chain_id=$1 AND f.canonical AND s.block_at>clock_timestamp()-interval '10 minutes'`,[chainId,protocolDeploymentForChain(chainId)?.addresses.otfToken?.toLowerCase()??null]);
    return Response.json({funds:rows},{headers:{"cache-control":"no-store"}});
  } catch {return Response.json({error:"VALUATIONS_UNAVAILABLE"},{status:503});}
}
