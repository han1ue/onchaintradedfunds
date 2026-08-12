import { recheckEvidence } from "@/server/admin";
import { apiError, apiOk } from "@/server/api";
import { assertCron } from "@/server/cron";
import { requireDb } from "@/server/db";
import { competitions, tweetEvidence } from "@/server/db/schema";
import { eq, lt } from "drizzle-orm";
export async function GET(request: Request) { try { assertCron(request); const database = requireDb(); const open = await database.select({ id: competitions.id }).from(competitions).where(eq(competitions.phase, "open")); for (const competition of open) await recheckEvidence(competition.id); await database.update(tweetEvidence).set({ rawText: null }).where(lt(tweetEvidence.rawTextExpiresAt, new Date())); return apiOk({ competitions: open.length }); } catch (error) { return apiError(error); } }
