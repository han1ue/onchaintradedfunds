import { and, eq, sql } from "drizzle-orm";
import { COMPETITION_RULES, getVotingStartsAt } from "@/lib/competition";
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
    .limit(1);
  if (!competition) throw new Error("COMPETITION_NOT_OPEN");
  return { ...competition, ...COMPETITION_RULES };
}

export async function requireEligibleActor(options: { votingRequired?: boolean } = {}) {
  const database = requireDb();
  const session = await requireSession();
  const competition = await currentCompetition();
  const [user] = await database.select().from(users).where(eq(users.id, session.user.id)).limit(1);
  if (!user || user.xUserId !== session.user.xUserId) throw new Error("X_RECONNECT_REQUIRED");
  if (options.votingRequired && Date.now() < getVotingStartsAt(competition.startsAt).getTime()) throw new Error("VOTING_NOT_OPEN");
  assertStoredXEligible(user, {
    minAccountAgeDays: COMPETITION_RULES.minAccountAgeDays,
    minFollowers: COMPETITION_RULES.minFollowers
  });
  return { session, user, competition };
}
