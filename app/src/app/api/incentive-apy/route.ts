import {
  protocolDeploymentForChain,
} from "@/lib/deployment";
import {
  incentiveWeekAt,
  OTF_INCENTIVE_WEEKS,
  weeklyEmissionBucketsOtf,
} from "@/lib/incentive-apy";

export const dynamic = "force-dynamic";

import { readPrices } from "@/server/pricing";

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const chainId = Number(searchParams.get("chainId"));
  const includePrice = searchParams.get("includePrice") !== "false";
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    return Response.json({ error: "INVALID_CHAIN_ID" }, { status: 400 });
  }
  const deployment = protocolDeploymentForChain(chainId);
  const launchManager = deployment?.addresses.launchManager;
  const rewardsDeployedAtMs = deployment?.rewardsDeployedAtMs;
  if (rewardsDeployedAtMs === undefined) {
    return Response.json({ error: "INCENTIVE_APY_UNAVAILABLE" }, { status: 503 });
  }

  const calculatedWeek = incentiveWeekAt(rewardsDeployedAtMs, Date.now());
  if (calculatedWeek === undefined) {
    return Response.json({ error: "INCENTIVE_SCHEDULE_NOT_STARTED" }, { status: 503 });
  }
  const ended = calculatedWeek > OTF_INCENTIVE_WEEKS;
  const buckets = ended
    ? { total: 0, depositors: 0, creators: 0 }
    : weeklyEmissionBucketsOtf(calculatedWeek);
  const schedule = {
    week: ended ? OTF_INCENTIVE_WEEKS : calculatedWeek,
    weeklyEmissionOtf: buckets.total,
    weeklyDepositorEmissionOtf: buckets.depositors,
    weeklyCreatorEmissionOtf: buckets.creators,
    ended,
  };
  if (!includePrice || !launchManager) {
    return Response.json(schedule, { headers: { "cache-control": "public, s-maxage=30, stale-while-revalidate=60" } });
  }

  try {
    const observation=(await readPrices(chainId)).find(price=>price.address.toLowerCase()===deployment?.addresses.otfToken?.toLowerCase() && price.usable);
    return Response.json({...schedule,...(observation?{otfPriceUsd:Number(observation.priceUsd),priceUpdatedAt:observation.priceUpdatedAt,priceQuality:observation.quality}: {})},
      {headers:{"cache-control":"no-store"}});
  } catch {
    return Response.json(schedule, { headers: { "cache-control": "public, s-maxage=30, stale-while-revalidate=60" } });
  }
}
