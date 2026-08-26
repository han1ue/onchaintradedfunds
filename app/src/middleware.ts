import { type NextRequest, NextResponse } from "next/server";

const APP_HOSTNAME = "app.onchaintradedfunds.com";

export function middleware(request: NextRequest) {
  const hostname = request.headers.get("host")?.split(":", 1)[0].toLowerCase();

  if (hostname !== APP_HOSTNAME) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = "/otfs";
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: "/",
};
