import { apiError, apiOk } from "@/server/api";
import { getEligibleAssets } from "@/server/data";
import { z } from "zod";
import { assertSameOrigin } from "@/server/api";
import { requireEligibleActor } from "@/server/guards";
import { requireDb } from "@/server/db";
import { assetMarketRequests } from "@/server/db/schema";
import { pricingConfigAddresses } from "@/lib/pricing-config";
import { evmAddressSchema, pricingConfigSchema } from "@/lib/validation";
export async function GET(request: Request) {
  try {
    return apiOk(await getEligibleAssets(new URL(request.url).searchParams.get("q") ?? ""));
  } catch (error) {
    return apiError(error);
  }
}

const requestSchema = z.object({
  network: z.literal("robinhood-mainnet"),
  assetAddress: evmAddressSchema,
  pricingConfig: pricingConfigSchema,
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { session } = await requireEligibleActor();
    const input = requestSchema.parse(await request.json());
    const addresses = pricingConfigAddresses(input.pricingConfig);
    const [queued] = await requireDb().insert(assetMarketRequests).values({
      requesterUserId: session.user.id,
      network: input.network,
      assetAddress: input.assetAddress,
      poolAddress: input.pricingConfig.source === "uniswap-v3" ? input.pricingConfig.poolAddress : null,
      pricingSource: input.pricingConfig.source,
      primaryAddress: addresses.primaryAddress,
      secondaryAddress: addresses.secondaryAddress,
    }).returning({ id: assetMarketRequests.id, status: assetMarketRequests.status });
    return apiOk(queued, { status: 202 });
  } catch (error) {
    return apiError(error);
  }
}
