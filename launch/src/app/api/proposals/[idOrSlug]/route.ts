import { apiError, apiOk } from "@/server/api";
import { getProposal } from "@/server/data";
export async function GET(_request: Request, context: { params: Promise<{ idOrSlug: string }> }) {
  try { const proposal = await getProposal((await context.params).idOrSlug); if (!proposal) throw new Error("PROPOSAL_NOT_FOUND"); return apiOk(proposal); } catch (error) { return apiError(error); }
}
