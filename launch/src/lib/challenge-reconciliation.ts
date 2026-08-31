import type { XActionChallengeStatus as ChallengeStatus } from "./challenge-status";

type ApiEnvelope = { data?: unknown; error?: { code?: unknown } };

export type ReconciledRequest =
  | { kind: "response"; response: Response; body: ApiEnvelope }
  | { kind: "status"; status: ChallengeStatus }
  | { kind: "unknown" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isApiEnvelope(value: unknown): value is ApiEnvelope {
  if (!isRecord(value)) return false;
  if ("data" in value) return true;
  return isRecord(value.error) && typeof value.error.code === "string";
}

function isChallengeStatus(value: unknown): value is ChallengeStatus {
  if (!isRecord(value) || typeof value.status !== "string") return false;
  if (value.status === "ready" || value.status === "expired") return true;
  if (value.status !== "succeeded" || typeof value.action !== "string" || typeof value.acceptedAt !== "string") return false;
  return value.action === "submission"
    ? typeof value.proposalId === "string" && typeof value.slug === "string"
    : value.action === "vote" && typeof value.ballotId === "string";
}

async function readChallengeStatus(challengeId: string, fetcher: typeof fetch): Promise<ChallengeStatus | null> {
  try {
    const response = await fetcher(`/api/x-challenges/${encodeURIComponent(challengeId)}`, {
      method: "GET",
      cache: "no-store",
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    return isRecord(body) && isChallengeStatus(body.data) ? body.data : null;
  } catch {
    return null;
  }
}

export async function requestWithChallengeReconciliation(
  request: () => Promise<Response>,
  challengeId: string,
  fetcher: typeof fetch = fetch,
  isSuccessData: (data: unknown) => boolean = () => true,
): Promise<ReconciledRequest> {
  try {
    const response = await request();
    const body: unknown = await response.json();
    if (!isApiEnvelope(body)) throw new Error("UNREADABLE_RESPONSE");
    if (response.ok && (!("data" in body) || !isSuccessData(body.data))) throw new Error("UNREADABLE_RESPONSE");
    return { kind: "response", response, body };
  } catch {
    const status = await readChallengeStatus(challengeId, fetcher);
    return status ? { kind: "status", status } : { kind: "unknown" };
  }
}
