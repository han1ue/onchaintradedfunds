import { issueVoteChallenge } from "@/server/actions";
import { apiError, apiOk, assertSameOrigin } from "@/server/api";
import { enforceRateLimit, verifyTurnstile } from "@/server/rate-limit";
export async function POST(request: Request, context: { params: Promise<{ idOrSlug: string }> }) {
  try { assertSameOrigin(request); await enforceRateLimit("write", request); const body = await request.json().catch(() => ({})); await verifyTurnstile(body.turnstileToken, request); return apiOk(await issueVoteChallenge((await context.params).idOrSlug), { status: 201 }); } catch (error) { return apiError(error); }
}
