import { apiError, apiOk, assertSameOrigin } from "@/server/api";
import { saveProposalDraft } from "@/server/actions";
import { enforceRateLimit } from "@/server/rate-limit";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await enforceRateLimit("write", request);
    const body = await request.json();
    const draftId = typeof body?.draftId === "string" ? body.draftId : undefined;
    return apiOk(await saveProposalDraft(body, draftId), { status: draftId ? 200 : 201 });
  } catch (error) { return apiError(error); }
}
