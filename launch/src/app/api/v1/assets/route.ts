import { apiError, apiOk } from "@/server/api";
import { getEligibleAssets } from "@/server/data";
import { z } from "zod";
import { assertSameOrigin } from "@/server/api";
import { requireEligibleActor } from "@/server/guards";
import { requireDb } from "@/server/db";
import { assetMarketRequests } from "@/server/db/schema";
export async function GET(request: Request) {
  try {
    return apiOk(await getEligibleAssets(new URL(request.url).searchParams.get("q") ?? ""));
  } catch (error) {
    return apiError(error);
  }
}

const requestSchema = z.object({
  network: z.literal("robinhood-mainnet"),
  assetAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  poolAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { session } = await requireEligibleActor();
    const input = requestSchema.parse(await request.json());
    const [queued] = await requireDb().insert(assetMarketRequests).values({
      requesterUserId: session.user.id,
      network: input.network,
      assetAddress: input.assetAddress.toLowerCase(),
      poolAddress: input.poolAddress.toLowerCase(),
    }).onConflictDoUpdate({
      target: [assetMarketRequests.network, assetMarketRequests.poolAddress],
      set: { requesterUserId: session.user.id, status: "pending", reason: null, updatedAt: new Date() },
    }).returning({ id: assetMarketRequests.id, status: assetMarketRequests.status });
    return apiOk(queued, { status: 202 });
  } catch (error) {
    return apiError(error);
  }
}
