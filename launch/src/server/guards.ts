import { and, desc, eq, sql } from "drizzle-orm";
import { auth } from "./auth";
import { requireDb } from "./db";
import { competitions, users } from "./db/schema";
import { assertStoredXEligible } from "./x";

export async function requireSession() {
  const session = await auth();
  if (!session?.user?.id || !session.user.xUserId) throw new Error("UNAUTHENTICATED");
  return session;
}

export async function currentCompetition() {
  const database = requireDb();
  const [competition] = await database.select().from(competitions)
    .where(and(eq(competitions.phase, "open"), sql`${competitions.startsAt} <= now()`, sql`${competitions.endsAt} > now()`))
    .orderBy(desc(competitions.startsAt)).limit(1);
  if (!competition) throw new Error("COMPETITION_NOT_OPEN");
  return competition;
}

export async function requireEligibleActor() {
  const database = requireDb();
  const session = await requireSession();
  const competition = await currentCompetition();
  const [user] = await database.select().from(users).where(eq(users.id, session.user.id)).limit(1);
  if (!user || user.xUserId !== session.user.xUserId) throw new Error("X_RECONNECT_REQUIRED");
  assertStoredXEligible(user, {
    minAccountAgeDays: competition.minAccountAgeDays,
    minFollowers: competition.minFollowers
  });
  return { session, user, competition };
}
