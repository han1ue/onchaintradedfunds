import { desc, eq } from "drizzle-orm";
import { apiError, apiOk } from "@/server/api";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { proposals, votes, xIdentitySnapshots } from "@/server/db/schema";
export async function GET() {
  try {
    const session = await auth(); if (!session?.user?.id) throw new Error("UNAUTHENTICATED");
    if (!db) return apiOk({ user: session.user, identity: null, proposals: [], votes: [] });
    const [identity, ownProposals, ownVotes] = await Promise.all([
      db.select().from(xIdentitySnapshots).where(eq(xIdentitySnapshots.userId, session.user.id)).orderBy(desc(xIdentitySnapshots.observedAt)).limit(1),
      db.select().from(proposals).where(eq(proposals.creatorUserId, session.user.id)),
      db.select().from(votes).where(eq(votes.voterUserId, session.user.id))
    ]);
    return apiOk({ user: session.user, identity: identity[0] ?? null, proposals: ownProposals, votes: ownVotes });
  } catch (error) { return apiError(error); }
}
