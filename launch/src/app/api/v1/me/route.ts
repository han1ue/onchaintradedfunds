import { and, eq, ne } from "drizzle-orm";
import { apiError, apiOk } from "@/server/api";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { ballotAllocations, ballots, competitions, proposals, users } from "@/server/db/schema";
import { expireProposalDrafts } from "@/server/actions";
export async function GET() {
  try {
    const session = await auth(); if (!session?.user?.id) throw new Error("UNAUTHENTICATED");
    if (!db) return apiOk({ user: session.user, identity: null, proposals: [], ballots: [], voteAllocations: [] });
    const [competition] = await db.select({ id: competitions.id }).from(competitions).limit(1);
    if (competition) await expireProposalDrafts(competition.id, session.user.id);
    const [identity, ownProposals, ownBallots, ownVoteAllocations] = await Promise.all([
      db.select().from(users).where(eq(users.id, session.user.id)).limit(1),
      db.select().from(proposals).where(and(eq(proposals.creatorUserId, session.user.id), ne(proposals.status, "deleted"))),
      db.select().from(ballots).where(eq(ballots.voterUserId, session.user.id)),
      db.select({ ballotId: ballotAllocations.ballotId, proposalId: ballotAllocations.proposalId, votes: ballotAllocations.votes })
        .from(ballotAllocations).innerJoin(ballots, eq(ballots.id, ballotAllocations.ballotId)).where(eq(ballots.voterUserId, session.user.id))
    ]);
    return apiOk({ user: session.user, identity: identity[0] ?? null, proposals: ownProposals, ballots: ownBallots, voteAllocations: ownVoteAllocations });
  } catch (error) { return apiError(error); }
}
