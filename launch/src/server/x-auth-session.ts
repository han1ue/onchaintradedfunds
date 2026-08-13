import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { accounts, sessions, users, verificationTokens, xIdentitySnapshots } from "./db/schema";
import { requireDb } from "./db";
import { getXUserById, snapshotFromXUser } from "./x";
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

    const [existingSnapshot] = await transaction.select().from(xIdentitySnapshots)
      .where(eq(xIdentitySnapshots.xUserId, xUserId))
      .orderBy(desc(xIdentitySnapshots.observedAt))
      .limit(1);
    const [existingAccount] = await transaction.select({ userId: accounts.userId }).from(accounts)
      .where(and(eq(accounts.provider, "twitter"), eq(accounts.providerAccountId, xUserId)))
      .limit(1);
    const [existingUser] = await transaction.select({ id: users.id }).from(users)
      .where(eq(users.xUserId, xUserId))
      .limit(1);

    const profile = existingSnapshot ? null : await getXUserById(xUserId);
    const username = existingSnapshot?.username ?? profile!.username;
    const displayName = existingSnapshot?.displayName ?? profile!.name;
    const image = existingSnapshot?.profileImageUrl ?? profile?.profile_image_url ?? null;
    let userId = existingAccount?.userId ?? existingUser?.id ?? existingSnapshot?.userId;

    if (!userId) {
      const [createdUser] = await transaction.insert(users).values({
        name: displayName,
        image,
        xUserId,
        xUsername: username,
      }).returning({ id: users.id });
      userId = createdUser.id;
    } else {
      await transaction.update(users).set({
        name: displayName,
        image,
        xUserId,
        xUsername: username,
        updatedAt: new Date(),
      }).where(eq(users.id, userId));
    }

    if (!existingAccount) {
      await transaction.insert(accounts).values({
        userId,
        type: "oauth",
        provider: "twitter",
        providerAccountId: xUserId,
      }).onConflictDoNothing();
    } else {
      await transaction.update(accounts).set({
        access_token: null,
        refresh_token: null,
        expires_at: null,
        scope: null,
        token_type: null,
      }).where(and(eq(accounts.provider, "twitter"), eq(accounts.providerAccountId, xUserId)));
    }

    if (profile) await transaction.insert(xIdentitySnapshots).values(snapshotFromXUser(userId, profile));
    return { userId, username };
  });
}

export async function createXSession(userId: string) {
  const database = requireDb();
  const sessionToken = randomUUID();
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await database.insert(sessions).values({ sessionToken, userId, expires });
  return { sessionToken, expires };
}
