import { NextResponse } from "next/server";
import { clearSessionCookies, sessionCookieNames } from "@/server/auth";
import { db } from "@/server/db";
import { sessions } from "@/server/db/schema";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";

export async function POST() {
  const cookieStore = await cookies();
  const sessionToken = sessionCookieNames.map((name) => cookieStore.get(name)?.value).find(Boolean);
  if (db && sessionToken) await db.delete(sessions).where(eq(sessions.sessionToken, sessionToken));
  await clearSessionCookies();
  return NextResponse.json({ ok: true });
}
