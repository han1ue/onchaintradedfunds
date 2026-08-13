import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "./db";
import { sessions, users } from "./db/schema";

export const sessionCookieNames = ["__Secure-otf-launch.session-token", "otf-launch.session-token"] as const;

export type LaunchSession = {
  user: {
    id: string;
    name: string;
    image: string | null;
    xUserId: string;
    xUsername: string;
  };
  expires: Date;
};

export async function auth(): Promise<LaunchSession | null> {
  if (!db) return null;
  const cookieStore = await cookies();
  const sessionToken = sessionCookieNames.map((name) => cookieStore.get(name)?.value).find(Boolean);
  if (!sessionToken) return null;
  const [record] = await db.select({
    expires: sessions.expires,
    id: users.id,
    name: users.displayName,
    image: users.profileImageUrl,
    xUserId: users.xUserId,
    xUsername: users.xUsername,
  }).from(sessions).innerJoin(users, eq(users.id, sessions.userId)).where(and(
    eq(sessions.sessionToken, sessionToken),
    gt(sessions.expires, new Date())
  )).limit(1);
  if (!record) return null;
  return {
    user: {
      id: record.id,
      name: record.name,
      image: record.image,
      xUserId: record.xUserId,
      xUsername: record.xUsername,
    },
    expires: record.expires,
  };
}

export async function clearSessionCookies() {
  const cookieStore = await cookies();
  for (const name of sessionCookieNames) cookieStore.delete(name);
}

export async function signOut({ redirectTo = "/" }: { redirectTo?: string } = {}) {
  if (db) {
    const cookieStore = await cookies();
    const sessionTokens = sessionCookieNames.map((name) => cookieStore.get(name)?.value).filter((value): value is string => Boolean(value));
    for (const sessionToken of sessionTokens) await db.delete(sessions).where(eq(sessions.sessionToken, sessionToken));
  }
  await clearSessionCookies();
  redirect(redirectTo);
}
