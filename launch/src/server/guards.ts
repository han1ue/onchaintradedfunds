import { and, eq, sql } from "drizzle-orm";
import { getVotingStartsAt } from "@/lib/competition";
import { auth } from "./auth";
import { requireDb } from "./db";
import { competitions, users } from "./db/schema";
import { assertStoredXEligible } from "./x";
import { assertCompetitionRulesSnapshot } from "./competition-rules";

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
  const rules = assertCompetitionRulesSnapshot(competition.rules, competition.rulesHash);
  return { ...competition, rules, ...rules };
}

export async function priceCapturePurpose(now: Date = new Date()) {
  const database = requireDb();
  const [competition] = await database.select({
    phase: competitions.phase,
    startsAt: competitions.startsAt,
    endsAt: competitions.endsAt,
  }).from(competitions).limit(1);
  if (!competition || competition.phase === "cancelled" || now < competition.startsAt) return null;
  if (now < competition.endsAt && competition.phase === "open") return "scoring" as const;
  return null;
}

export async function requireEligibleActor(options: { votingRequired?: boolean } = {}) {
  const database = requireDb();
  const session = await requireSession();
  const competition = await currentCompetition();
  const [user] = await database.select().from(users).where(eq(users.id, session.user.id)).limit(1);
  if (!user || user.xUserId !== session.user.xUserId) throw new Error("X_RECONNECT_REQUIRED");
  if (options.votingRequired && Date.now() < getVotingStartsAt(competition.startsAt, competition.rules).getTime()) throw new Error("VOTING_NOT_OPEN");
  assertStoredXEligible(user, {
    minAccountAgeDays: competition.rules.minAccountAgeDays,
    minFollowers: competition.rules.minFollowers
  });
  return { session, user, competition };
}
