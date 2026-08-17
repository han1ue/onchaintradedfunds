import { evmAddressSchema } from "@/lib/validation";
import { apiError, apiOk, assertSameOrigin } from "@/server/api";
import { getCompetition } from "@/server/data";
import { validateUnlistedAsset } from "@/server/unlisted-asset-validation";
import { z } from "zod";

const querySchema = z.object({
  assetAddress: evmAddressSchema,
  poolAddress: evmAddressSchema,
});

export async function GET(request: Request) {
  try {
    assertSameOrigin(request);
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const competition = await getCompetition();
    return apiOk(await validateUnlistedAsset({
      assetAddress: query.assetAddress,
      poolAddress: query.poolAddress,
      competitionStartsAt: new Date(competition.startsAt),
    }));
  } catch (error) {
    return apiError(error, "ASSET_MARKET_VALIDATION_UNAVAILABLE");
  }
}
