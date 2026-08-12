import { recheckEvidence } from "@/server/admin";
import { apiError, apiOk } from "@/server/api";
import { assertCron } from "@/server/cron";
import { requireDb } from "@/server/db";
import { competitions } from "@/server/db/schema";
import { eq } from "drizzle-orm";
export async function GET(request: Request) { try { assertCron(request); const database = requireDb(); const open = await database.select({ id: competitions.id }).from(competitions).where(eq(competitions.phase, "open")); for (const competition of open) await recheckEvidence(competition.id); return apiOk({ competitions: open.length }); } catch (error) { return apiError(error); } }
