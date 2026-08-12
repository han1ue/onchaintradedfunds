import { setAssetEnabled } from "@/server/admin";
import { apiError, apiOk, assertSameOrigin } from "@/server/api";
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) { try { assertSameOrigin(request); const body = await request.json(); return apiOk(await setAssetEnabled((await context.params).id, Boolean(body.enabled), String(body.reason ?? ""))); } catch (error) { return apiError(error); } }
