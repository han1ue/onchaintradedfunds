import { issueSubmissionChallenge } from "@/server/actions";
import { apiError, apiOk, assertSameOrigin } from "@/server/api";
import { enforceRateLimit } from "@/server/rate-limit";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try { assertSameOrigin(request); await enforceRateLimit("proof", request); return apiOk(await issueSubmissionChallenge((await context.params).id), { status: 201 }); } catch (error) { return apiError(error); }
}
