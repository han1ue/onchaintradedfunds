import { type NextRequest, NextResponse } from "next/server";
import { isAppHostname } from "@/config/site";

export function middleware(request: NextRequest) {
  if (!isAppHostname(request.headers.get("host"))) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = "/otfs";
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: "/",
};
