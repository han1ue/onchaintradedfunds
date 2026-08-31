import { apiError, apiOk, assertSameOrigin } from "@/server/api";
import { prepareBallotProof, verifyBallotProof } from "@/server/ballot";
import { enforceRateLimit, verifyTurnstile } from "@/server/rate-limit";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = await request.json();
    await enforceRateLimit(body.action === "verify" ? "verify" : "post", request);
    if (body.action === "verify") return apiOk(await verifyBallotProof(body), { status: 201 });
    await verifyTurnstile(body.turnstileToken, request, "vote_otf");
    return apiOk(await prepareBallotProof(body), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
