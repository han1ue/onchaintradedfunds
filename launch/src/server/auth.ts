import NextAuth from "next-auth";
import Twitter from "next-auth/providers/twitter";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { accounts, sessions, users, verificationTokens, xIdentitySnapshots } from "./db/schema";
import { env } from "./env";
import { getXUserById, snapshotFromXUser } from "./x";

const adapter = db ? DrizzleAdapter(db, { usersTable: users, accountsTable: accounts, sessionsTable: sessions, verificationTokensTable: verificationTokens }) : undefined;

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter,
  secret: env.AUTH_SECRET ?? (process.env.NODE_ENV !== "production" ? "otf-launch-local-development-secret" : undefined),
  trustHost: true,
  session: { strategy: adapter ? "database" : "jwt" },
  providers: [Twitter({
    clientId: env.AUTH_X_ID ?? "not-configured",
    clientSecret: env.AUTH_X_SECRET ?? "not-configured",
    authorization: {
      url: "https://x.com/i/oauth2/authorize",
      params: { scope: "users.read" }
    }
  })],
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account?.provider === "twitter") {
        token.xUserId = account.providerAccountId;
        token.xUsername = typeof profile?.data === "object" && profile.data && "username" in profile.data ? String(profile.data.username) : undefined;
      }
      return token;
    },
    async session({ session, user, token }) {
      session.user.id = user?.id ?? String(token.sub ?? "");
      if (db && user?.id) {
        const [record] = await db.select({ xUserId: users.xUserId, xUsername: users.xUsername }).from(users).where(eq(users.id, user.id)).limit(1);
        session.user.xUserId = record?.xUserId;
        session.user.xUsername = record?.xUsername;
      } else {
        session.user.xUserId = typeof token.xUserId === "string" ? token.xUserId : null;
        session.user.xUsername = typeof token.xUsername === "string" ? token.xUsername : null;
      }
      return session;
    }
  },
  events: {
    async signIn({ user, account }) {
      if (!db || account?.provider !== "twitter" || !user.id) return;
      const [existingSnapshot] = await db.select({ username: xIdentitySnapshots.username })
        .from(xIdentitySnapshots)
        .where(and(eq(xIdentitySnapshots.userId, user.id), eq(xIdentitySnapshots.xUserId, account.providerAccountId)))
        .limit(1);

      if (existingSnapshot) {
        await db.transaction(async (transaction) => {
          await transaction.update(users).set({
            xUserId: account.providerAccountId,
            xUsername: existingSnapshot.username,
            updatedAt: new Date()
          }).where(eq(users.id, user.id!));
          await transaction.update(accounts).set({
            access_token: null,
            refresh_token: null,
            expires_at: null,
            scope: account.scope,
            token_type: account.token_type
          }).where(and(eq(accounts.provider, "twitter"), eq(accounts.providerAccountId, account.providerAccountId)));
        });
        return;
      }

      const profile = await getXUserById(account.providerAccountId);
      await db.transaction(async (transaction) => {
        await transaction.update(users).set({ xUserId: profile.id, xUsername: profile.username, updatedAt: new Date() }).where(eq(users.id, user.id!));
        await transaction.insert(xIdentitySnapshots).values(snapshotFromXUser(user.id!, profile));
        await transaction.update(accounts).set({
          access_token: null,
          refresh_token: null,
          expires_at: null,
          scope: account.scope,
          token_type: account.token_type
        }).where(and(eq(accounts.provider, "twitter"), eq(accounts.providerAccountId, account.providerAccountId)));
      });
    }
  }
});
