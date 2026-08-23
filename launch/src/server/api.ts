import { NextResponse } from "next/server";
import { z } from "zod";
import { PublicApiError } from "@/lib/errors";

export const DEFAULT_PUBLIC_LIST_LIMIT = 50;
export const MAX_PUBLIC_LIST_LIMIT = 100;

const publicListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PUBLIC_LIST_LIMIT).default(DEFAULT_PUBLIC_LIST_LIMIT),
  cursor: z.string().regex(/^[1-9]\d*$/).transform(Number).optional(),
  q: z.string().trim().max(100).default(""),
});

export function parsePublicListQuery(request: Request) {
  const url = new URL(request.url);
  const parsed = publicListQuerySchema.safeParse({
    limit: url.searchParams.get("limit") ?? undefined,
    cursor: url.searchParams.get("cursor") ?? undefined,
    q: url.searchParams.get("q") ?? undefined,
  });
  if (!parsed.success) throw new Error("INVALID_QUERY");
  return parsed.data;
}

export function apiOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ data }, init);
}

export function apiError(error: unknown, fallback = "INTERNAL_ERROR") {
  const rawCode = error instanceof Error ? error.message : fallback;
  const code = /^[A-Z0-9_]+$/.test(rawCode) ? rawCode : fallback;
  if (code === fallback && rawCode !== fallback) console.error("API request failed", error);
  const status = code === "UNAUTHENTICATED" ? 401 : code === "FORBIDDEN" ? 403 : code.includes("NOT_FOUND") ? 404 : code === "DATABASE_NOT_CONFIGURED" || code === "X_UNAVAILABLE" || code === "RATE_LIMIT_UNAVAILABLE" || code === "ASSET_MARKET_VALIDATION_UNAVAILABLE" ? 503 : code === "RATE_LIMITED" ? 429 : 400;
  return NextResponse.json({ error: { code, ...(error instanceof PublicApiError ? { metadata: error.metadata } : {}) } }, { status: code === fallback ? 500 : status });
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  if (new URL(origin).host !== new URL(request.url).host) throw new Error("ORIGIN_MISMATCH");
}
