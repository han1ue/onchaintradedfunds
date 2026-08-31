import { moderateProposal } from "@/server/admin";
import { apiError, apiOk, assertSameOrigin } from "@/server/api";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) { try { assertSameOrigin(request); const body = await request.json(); if (!['hidden','disqualified'].includes(body.status)) throw new Error("INVALID_STATUS"); return apiOk(await moderateProposal((await context.params).id, body.status, String(body.reason ?? ""))); } catch (error) { return apiError(error); } }
