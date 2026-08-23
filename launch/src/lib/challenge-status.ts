export type ChallengeStatusRow = {
  action: "submission" | "vote";
  proposalId: string | null;
  resultBallotId: string | null;
  resultSlug: string | null;
  expiresAt: Date;
  consumedAt: Date | null;
};

export type XActionChallengeStatus =
  | { status: "ready" }
  | { status: "expired" }
  | {
    status: "succeeded";
    action: "submission";
    proposalId: string;
    slug: string;
    acceptedAt: string;
  }
  | {
    status: "succeeded";
    action: "vote";
    ballotId: string;
    acceptedAt: string;
  };

export function describeXActionChallenge(
  challenge: ChallengeStatusRow,
  now: Date = new Date(),
): XActionChallengeStatus {
  if (challenge.consumedAt) {
    if (challenge.action === "submission" && challenge.proposalId && challenge.resultSlug) {
      return {
        status: "succeeded",
        action: "submission",
        proposalId: challenge.proposalId,
        slug: challenge.resultSlug,
        acceptedAt: challenge.consumedAt.toISOString(),
      };
    }
    if (challenge.action === "vote" && challenge.resultBallotId) {
      return {
        status: "succeeded",
        action: "vote",
        ballotId: challenge.resultBallotId,
        acceptedAt: challenge.consumedAt.toISOString(),
      };
    }
    throw new Error("CHALLENGE_RESULT_UNAVAILABLE");
  }
  return challenge.expiresAt > now ? { status: "ready" } : { status: "expired" };
}
