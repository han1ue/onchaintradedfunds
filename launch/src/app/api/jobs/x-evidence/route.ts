import { recheckEvidence } from "@/server/admin";
import { apiError, apiOk } from "@/server/api";
import { assertCron } from "@/server/cron";
import { requireDb } from "@/server/db";
import { competitions, tweetEvidence } from "@/server/db/schema";
import { and, eq, lt, sql } from "drizzle-orm";

export async function GET(request: Request) {
  try {
    assertCron(request);
    const database = requireDb();
    const [open] = await database.select({ id: competitions.id }).from(competitions).where(and(
      eq(competitions.phase, "open"),
      sql`${competitions.endsAt} > now()`,
    )).limit(1);
    if (open) await recheckEvidence(open.id);
    await database.update(tweetEvidence).set({ rawText: null }).where(lt(tweetEvidence.rawTextExpiresAt, new Date()));
    return apiOk({ competition: open ? "checked" : "inactive" });
  } catch (error) {
    return apiError(error);
  }
}
