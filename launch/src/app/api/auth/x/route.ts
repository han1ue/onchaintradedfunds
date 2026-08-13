import { NextResponse } from "next/server";
import { storeXOAuthState } from "@/server/x-auth-session";
import { canonicalXAuthOrigin, requestXOAuthToken, sanitizeCallbackPath, xAuthenticateUrl } from "@/server/x-oauth1";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = canonicalXAuthOrigin(requestUrl);
  try {
    const callbackUrl = new URL("/api/auth/x/callback", origin).toString();
    const callbackPath = sanitizeCallbackPath(requestUrl.searchParams.get("callbackUrl"));
    const forceLogin = requestUrl.searchParams.get("forceLogin") === "1";
    const { requestToken, requestTokenSecret } = await requestXOAuthToken(callbackUrl);
    await storeXOAuthState(requestToken, requestTokenSecret, callbackPath);
    return NextResponse.redirect(xAuthenticateUrl(requestToken, forceLogin));
  } catch (error) {
    console.error("[x-oauth1] Sign-in could not start:", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.redirect(new URL("/?authError=x_signin_failed", origin));
  }
}
