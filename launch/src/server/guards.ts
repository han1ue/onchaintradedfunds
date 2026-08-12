import { and, desc, eq, sql } from "drizzle-orm";
import { auth } from "./auth";
import { requireDb } from "./db";
import { competitions, xIdentitySnapshots } from "./db/schema";
import { assertXEligible, getXUser, snapshotFromXUser } from "./x";

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

export async function requireEligibleActor(options: { forVote?: boolean } = {}) {
  const database = requireDb();
  const session = await requireSession();
  const competition = await currentCompetition();
  const profile = await getXUser(session.user.xUserId!);
  assertXEligible(profile, {
    minAccountAgeDays: competition.minAccountAgeDays,
    minFollowers: options.forVote ? competition.minFollowers : undefined
  });
  const [snapshot] = await database.insert(xIdentitySnapshots).values(snapshotFromXUser(session.user.id, profile)).returning();
  return { session, profile, snapshot, competition };
}
