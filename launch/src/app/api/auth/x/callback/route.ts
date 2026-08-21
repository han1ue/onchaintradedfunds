import { NextResponse } from "next/server";
import { consumeXOAuthState, createXSession, findOrCreateXUser } from "@/server/x-auth-session";
import { canonicalXAuthOrigin, exchangeXOAuthToken } from "@/server/x-oauth1";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = canonicalXAuthOrigin();
  const requestToken = requestUrl.searchParams.get("oauth_token");
  const verifier = requestUrl.searchParams.get("oauth_verifier");
  if (!requestToken || !verifier || requestUrl.searchParams.has("denied")) {
    return NextResponse.redirect(new URL("/?authError=x_signin_cancelled", origin));
  }

  try {
    const state = await consumeXOAuthState(requestToken);
    const identity = await exchangeXOAuthToken(requestToken, state.requestTokenSecret, verifier);
    const user = await findOrCreateXUser(identity.xUserId);
    const session = await createXSession(user.userId);
    const response = NextResponse.redirect(new URL(state.callbackPath, origin));
    const secure = new URL(origin).protocol === "https:";
    response.cookies.set(`${secure ? "__Secure-" : ""}otf-launch.session-token`, session.sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure,
      expires: session.expires,
    });
    return response;
  } catch (error) {
    console.error("[x-oauth1] Callback failed:", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.redirect(new URL("/?authError=x_signin_failed", origin));
  }
}
