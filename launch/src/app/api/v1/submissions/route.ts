import { apiError, apiOk, assertSameOrigin } from "@/server/api";
import { saveProposalDraft } from "@/server/actions";
import { enforceRateLimit, verifyTurnstile } from "@/server/rate-limit";
export async function POST(request: Request) {
  try { assertSameOrigin(request); await enforceRateLimit("write", request); const body = await request.json(); await verifyTurnstile(body.turnstileToken, request); return apiOk(await saveProposalDraft(body), { status: 201 }); } catch (error) { return apiError(error); }
}
