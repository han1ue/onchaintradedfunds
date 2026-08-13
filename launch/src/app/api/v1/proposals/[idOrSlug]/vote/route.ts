import { apiError, apiOk, assertSameOrigin } from "@/server/api";
import { prepareVoteProof, verifyVoteProof } from "@/server/actions";
import { enforceRateLimit, verifyTurnstile } from "@/server/rate-limit";

export async function POST(request: Request, context: { params: Promise<{ idOrSlug: string }> }) {
  try {
    assertSameOrigin(request);
    await enforceRateLimit("post", request);
    const body = await request.json();
    const idOrSlug = (await context.params).idOrSlug;
    if (body.postUrl) return apiOk(await verifyVoteProof(idOrSlug, body), { status: 201 });
    await verifyTurnstile(body.turnstileToken, request, "vote_otf");
    return apiOk(await prepareVoteProof(idOrSlug, body), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
