import { desc, eq } from "drizzle-orm";
import type { ParticipationEligibility } from "@/lib/types";
import { db } from "./db";
import { xIdentitySnapshots } from "./db/schema";

type ConnectedUser = { id?: string | null; xUserId?: string | null } | null | undefined;
type Requirements = { minFollowers: number; minAccountAgeDays: number };

export async function getParticipationEligibility(user: ConnectedUser, requirements: Requirements): Promise<ParticipationEligibility> {
  const base = {
    minFollowers: requirements.minFollowers,
    minAccountAgeDays: requirements.minAccountAgeDays,
  };
  if (!user?.id || !user.xUserId) {
    return { ...base, connected: false, eligible: false, verified: null, publicAccount: null, followersCount: null, oldEnough: null };
  }
  if (!db) {
    return { ...base, connected: true, eligible: false, verified: null, publicAccount: null, followersCount: null, oldEnough: null };
  }

  const [snapshot] = await db.select().from(xIdentitySnapshots)
    .where(eq(xIdentitySnapshots.userId, user.id))
    .orderBy(desc(xIdentitySnapshots.observedAt))
    .limit(1);
  if (!snapshot || snapshot.xUserId !== user.xUserId) {
    return { ...base, connected: true, eligible: false, verified: null, publicAccount: null, followersCount: null, oldEnough: null };
  }

  const publicAccount = !snapshot.protected;
  const oldEnough = Date.now() - snapshot.accountCreatedAt.getTime() >= requirements.minAccountAgeDays * 86_400_000;
  return {
    ...base,
    connected: true,
    eligible: snapshot.verified && publicAccount && snapshot.followersCount >= requirements.minFollowers && oldEnough,
    verified: snapshot.verified,
    publicAccount,
    followersCount: snapshot.followersCount,
    oldEnough,
  };
}
