import { NextResponse } from "next/server";

export function apiOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ data }, init);
}

export function apiError(error: unknown, fallback = "INTERNAL_ERROR") {
  const code = error instanceof Error ? error.message : fallback;
  const status = code === "UNAUTHENTICATED" ? 401 : code === "FORBIDDEN" ? 403 : code.includes("NOT_FOUND") ? 404 : code === "DATABASE_NOT_CONFIGURED" || code === "X_UNAVAILABLE" || code === "RATE_LIMIT_UNAVAILABLE" ? 503 : code === "RATE_LIMITED" ? 429 : 400;
  return NextResponse.json({ error: { code } }, { status });
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  if (new URL(origin).host !== new URL(request.url).host) throw new Error("ORIGIN_MISMATCH");
}
