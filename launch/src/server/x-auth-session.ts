import { randomUUID } from "node:crypto";
import { and, eq, like, lt, sql } from "drizzle-orm";
import { sessions, users, verificationTokens } from "./db/schema";
import { requireDb } from "./db";
import { getXUserById, userIdentityFromXUser } from "./x";
import { openXOAuthState, sealXOAuthState, xOAuthStateTtlMs } from "./x-oauth1";

const oauthStateIdentifier = (requestToken: string) => `x-oauth1:${requestToken}`;
type StoredXUser = { id: string; xUsername: string };
type XProfileFetcher = typeof getXUserById;

export async function resolveXUserForSignIn(existingUser: StoredXUser | undefined, xUserId: string, fetchProfile: XProfileFetcher = getXUserById) {
  if (existingUser) return { kind: "existing" as const, userId: existingUser.id, username: existingUser.xUsername };
  const fetchedProfile = await fetchProfile(xUserId);
  return { kind: "new" as const, identity: userIdentityFromXUser(fetchedProfile.profile, fetchedProfile.providerProfile) };
}

export async function storeXOAuthState(requestToken: string, requestTokenSecret: string, callbackPath: string) {
  const database = requireDb();
  await database.delete(verificationTokens).where(and(
    like(verificationTokens.identifier, "x-oauth1:%"),
    lt(verificationTokens.expires, new Date()),
  ));
  const expires = new Date(Date.now() + xOAuthStateTtlMs);
  await database.insert(verificationTokens).values({
    identifier: oauthStateIdentifier(requestToken),
    token: sealXOAuthState({ requestTokenSecret, callbackPath, createdAt: Date.now() }),
    expires,
  });
}

export async function consumeXOAuthState(requestToken: string) {
  const database = requireDb();
  const [record] = await database.delete(verificationTokens)
    .where(eq(verificationTokens.identifier, oauthStateIdentifier(requestToken)))
    .returning({ token: verificationTokens.token, expires: verificationTokens.expires });
  if (!record || record.expires.getTime() < Date.now()) throw new Error("X_RECONNECT_REQUIRED");
  return openXOAuthState(record.token);
}

export async function findOrCreateXUser(xUserId: string) {
  const database = requireDb();
  return database.transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${xUserId}))`);
    const [existingUser] = await transaction.select({ id: users.id, xUsername: users.xUsername }).from(users)
      .where(eq(users.xUserId, xUserId))
      .limit(1);
    // Cost invariant: the paid profile API is creation-only. Never fetch before this existing-user check.
    const resolved = await resolveXUserForSignIn(existingUser, xUserId);
    if (resolved.kind === "existing") return { userId: resolved.userId, username: resolved.username };
    const [createdUser] = await transaction.insert(users).values(resolved.identity).returning({ id: users.id });
    return { userId: createdUser.id, username: resolved.identity.xUsername };
  });
}

export async function createXSession(userId: string) {
  const database = requireDb();
  const sessionToken = randomUUID();
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await database.insert(sessions).values({ sessionToken, userId, expires });
  return { sessionToken, expires };
}
