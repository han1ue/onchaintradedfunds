import { NextResponse } from "next/server";
import { storeXOAuthState } from "@/server/x-auth-session";
import { canonicalXAuthOrigin, requestXOAuthToken, sanitizeCallbackPath, xAuthenticateUrl } from "@/server/x-oauth1";
import { enforceRateLimit } from "@/server/rate-limit";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = canonicalXAuthOrigin();
  try {
    await enforceRateLimit("oauth", request);
    const callbackUrl = new URL("/api/auth/x/callback", origin).toString();
    const callbackPath = sanitizeCallbackPath(requestUrl.searchParams.get("callbackUrl"));
    const forceLogin = requestUrl.searchParams.get("forceLogin") === "1";
    const { requestToken, requestTokenSecret } = await requestXOAuthToken(callbackUrl);
    await storeXOAuthState(requestToken, requestTokenSecret, callbackPath);
    return NextResponse.redirect(xAuthenticateUrl(requestToken, forceLogin));
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    console.error("[x-oauth1] Sign-in could not start:", code);
    const authError = code === "RATE_LIMITED"
      ? "x_signin_rate_limited"
      : code === "RATE_LIMIT_UNAVAILABLE"
        ? "x_signin_unavailable"
        : "x_signin_failed";
    return NextResponse.redirect(new URL(`/?authError=${authError}`, origin));
  }
}
