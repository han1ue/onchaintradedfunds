import { apiError, apiOk, assertSameOrigin } from "@/server/api";
import { prepareBallotProof, updateBallotDistribution, verifyBallotProof } from "@/server/ballot";
import { enforceRateLimit, verifyTurnstile } from "@/server/rate-limit";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = await request.json();
    if (body.action === "update") {
      await enforceRateLimit("write", request);
      return apiOk(await updateBallotDistribution(body));
    }
    await enforceRateLimit("post", request);
    if (body.action === "verify") return apiOk(await verifyBallotProof(body), { status: 201 });
    await verifyTurnstile(body.turnstileToken, request, "vote_otf");
    return apiOk(await prepareBallotProof(body), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
