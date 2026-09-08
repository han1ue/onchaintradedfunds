import { timingSafeEqual } from "node:crypto";
import { collectPrices, collectMarketCaps } from "@/server/pricing";
import { collectFundSnapshots } from "@/server/nav";
export const dynamic="force-dynamic";
export const maxDuration=300;
export async function GET(request:Request) {
  const secret=process.env.CRON_SECRET,header=request.headers.get("authorization")??"";
  if (!secret || Buffer.byteLength(header)!==Buffer.byteLength(`Bearer ${secret}`) || !timingSafeEqual(Buffer.from(header),Buffer.from(`Bearer ${secret}`))) return Response.json({error:"UNAUTHORIZED"},{status:401});
  const jobs: Record<string,unknown>={};
  for (const [name,run] of [["prices",collectPrices],["funds",async()=>Promise.allSettled([collectFundSnapshots(46630),collectFundSnapshots(4663)]).then(results=>results.map(result=>result.status==="fulfilled"?result.value:{error:"COLLECTION_FAILED"}))],["marketCaps",collectMarketCaps]] as const) {
    try { jobs[name]=await run()??{state:"already_running"}; }
    catch { jobs[name]={error:"COLLECTION_FAILED"}; }
  }
  const failed=(value:unknown):boolean=>Array.isArray(value)?value.some(failed):Boolean(value && typeof value==="object" && ("error" in value || "failed" in value && Number(value.failed)>0));
  return Response.json(jobs,{status:Object.values(jobs).some(failed)?503:200});
}
