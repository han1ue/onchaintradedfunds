import { apiError, apiOk, assertSameOrigin } from "@/server/api";
import { saveProposalDraft } from "@/server/actions";
import { enforceRateLimit } from "@/server/rate-limit";
export async function POST(request: Request) {
  try { assertSameOrigin(request); await enforceRateLimit("write", request); return apiOk(await saveProposalDraft(await request.json()), { status: 201 }); } catch (error) { return apiError(error); }
}
