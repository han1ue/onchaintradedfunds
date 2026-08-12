import { desc, eq } from "drizzle-orm";
import { apiError, apiOk } from "@/server/api";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { activityEvents } from "@/server/db/schema";
export async function GET() {
  try { const session = await auth(); if (!session?.user?.id) throw new Error("UNAUTHENTICATED"); if (!db) return apiOk([]); return apiOk(await db.select().from(activityEvents).where(eq(activityEvents.actorUserId, session.user.id)).orderBy(desc(activityEvents.occurredAt)).limit(100)); } catch (error) { return apiError(error); }
}
