import { eq } from "drizzle-orm";
import type { ParticipationEligibility } from "@/lib/types";
import { db } from "./db";
import { users } from "./db/schema";
import { isParticipationAllowlistedXUserId } from "./participation-allowlist";

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

  const [identity] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
  if (!identity || identity.xUserId !== user.xUserId) {
    return { ...base, connected: true, eligible: false, verified: null, publicAccount: null, followersCount: null, oldEnough: null };
  }

  const publicAccount = !identity.protected;
  const oldEnough = Date.now() - identity.accountCreatedAt.getTime() >= requirements.minAccountAgeDays * 86_400_000;
  const allowlisted = isParticipationAllowlistedXUserId(identity.xUserId);
  return {
    ...base,
    connected: true,
    eligible: publicAccount && oldEnough && (allowlisted || (identity.verified && identity.followersCount >= requirements.minFollowers)),
    verified: identity.verified,
    publicAccount,
    followersCount: identity.followersCount,
    oldEnough,
  };
}
