import { apiError, apiOk, assertSameOrigin } from "@/server/api";
import { publishVoteToX } from "@/server/actions";
import { enforceRateLimit, verifyTurnstile } from "@/server/rate-limit";

export async function POST(request: Request, context: { params: Promise<{ idOrSlug: string }> }) {
  try {
    assertSameOrigin(request);
    await enforceRateLimit("post", request);
    const body = await request.json();
    await verifyTurnstile(body.turnstileToken, request);
    return apiOk(await publishVoteToX((await context.params).idOrSlug, body), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
