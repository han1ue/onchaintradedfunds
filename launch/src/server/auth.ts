import NextAuth from "next-auth";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { accounts, sessions, users, verificationTokens } from "./db/schema";
import { env } from "./env";

const adapter = db ? DrizzleAdapter(db, { usersTable: users, accountsTable: accounts, sessionsTable: sessions, verificationTokensTable: verificationTokens }) : undefined;

export const { handlers, auth, signOut } = NextAuth({
  adapter,
  secret: env.AUTH_SECRET ?? (process.env.NODE_ENV !== "production" ? "otf-launch-local-development-secret" : undefined),
  trustHost: true,
  session: { strategy: adapter ? "database" : "jwt" },
  providers: [],
  callbacks: {
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
  }
});
