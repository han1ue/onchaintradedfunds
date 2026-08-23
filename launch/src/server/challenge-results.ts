import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { describeXActionChallenge } from "@/lib/challenge-status";
import { requireDb } from "./db";
import { xActionChallenges } from "./db/schema";
import { requireSession } from "./guards";

export async function getXActionChallengeStatus(challengeId: string) {
  if (!z.string().uuid().safeParse(challengeId).success) throw new Error("CHALLENGE_NOT_FOUND");
  const session = await requireSession();
  const database = requireDb();
  const [challenge] = await database.select({
    action: xActionChallenges.action,
    proposalId: xActionChallenges.proposalId,
    resultBallotId: xActionChallenges.resultBallotId,
    resultSlug: xActionChallenges.resultSlug,
    expiresAt: xActionChallenges.expiresAt,
    consumedAt: xActionChallenges.consumedAt,
  }).from(xActionChallenges).where(and(
    eq(xActionChallenges.id, challengeId),
    eq(xActionChallenges.userId, session.user.id),
  )).limit(1);
  if (!challenge) throw new Error("CHALLENGE_NOT_FOUND");
  return describeXActionChallenge(challenge);
}
