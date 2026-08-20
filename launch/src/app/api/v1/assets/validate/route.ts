import { evmAddressSchema } from "@/lib/validation";
import { apiError, apiOk, assertSameOrigin } from "@/server/api";
import { requireEligibleActor } from "@/server/guards";
import { enforceRateLimit } from "@/server/rate-limit";
import { validateUnlistedAsset } from "@/server/unlisted-asset-validation";
import { z } from "zod";

const querySchema = z.object({
  assetAddress: evmAddressSchema,
  poolAddress: evmAddressSchema.optional(),
});

export async function GET(request: Request) {
  try {
    assertSameOrigin(request);
    const { session, competition } = await requireEligibleActor();
    await enforceRateLimit("asset", request, session.user.id);
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return apiOk(await validateUnlistedAsset({
      assetAddress: query.assetAddress,
      poolAddress: query.poolAddress,
      competitionStartsAt: competition.startsAt,
    }));
  } catch (error) {
    return apiError(error, "ASSET_MARKET_VALIDATION_UNAVAILABLE");
  }
}
