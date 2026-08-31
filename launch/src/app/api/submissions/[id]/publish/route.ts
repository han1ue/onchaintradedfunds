import { apiError, apiOk, assertSameOrigin } from "@/server/api";
import { prepareProposalProof, verifyProposalProof } from "@/server/actions";
import { enforceRateLimit, verifyTurnstile } from "@/server/rate-limit";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const body = await request.json();
    await enforceRateLimit(body.postUrl ? "verify" : "post", request);
    const id = (await context.params).id;
    if (body.postUrl) return apiOk(await verifyProposalProof(id, body), { status: 201 });
    await verifyTurnstile(body.turnstileToken, request, "submit_otf");
    return apiOk(await prepareProposalProof(id, body), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
