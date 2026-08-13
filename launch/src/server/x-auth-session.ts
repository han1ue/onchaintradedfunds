import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { sessions, users, verificationTokens } from "./db/schema";
import { requireDb } from "./db";
import { getXUserById, userIdentityFromXUser } from "./x";
import { openXOAuthState, sealXOAuthState, xOAuthStateTtlMs } from "./x-oauth1";

const oauthStateIdentifier = (requestToken: string) => `x-oauth1:${requestToken}`;

export async function storeXOAuthState(requestToken: string, requestTokenSecret: string, callbackPath: string) {
  const database = requireDb();
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
    const fetchedProfile = await getXUserById(xUserId);
    const identity = userIdentityFromXUser(fetchedProfile.profile, fetchedProfile.providerProfile);
    const [existingUser] = await transaction.select({ id: users.id }).from(users)
      .where(eq(users.xUserId, xUserId))
      .limit(1);
    let userId = existingUser?.id;
    if (userId) {
      await transaction.update(users).set(identity).where(eq(users.id, userId));
    } else {
      const [createdUser] = await transaction.insert(users).values({
        ...identity,
      }).returning({ id: users.id });
      userId = createdUser.id;
    }
    return { userId, username: identity.xUsername };
  });
}

export async function createXSession(userId: string) {
  const database = requireDb();
  const sessionToken = randomUUID();
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await database.insert(sessions).values({ sessionToken, userId, expires });
  return { sessionToken, expires };
}
