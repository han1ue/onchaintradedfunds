export const PROPOSAL_VOTE_DELAY_MS = 30 * 60_000;

export function getProposalVotingStartsAt(acceptedAt: string | Date) {
  return new Date(new Date(acceptedAt).getTime() + PROPOSAL_VOTE_DELAY_MS);
}

export function isProposalVotingOpen(acceptedAt: string | Date, now: Date | number = new Date()) {
  const nowMs = typeof now === "number" ? now : now.getTime();
  return nowMs >= getProposalVotingStartsAt(acceptedAt).getTime();
}

export function formatProposalVoteCountdown(acceptedAt: string | Date, now: Date | number = new Date()) {
  const nowMs = typeof now === "number" ? now : now.getTime();
  const remainingSeconds = Math.max(0, Math.ceil((getProposalVotingStartsAt(acceptedAt).getTime() - nowMs) / 1_000));
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
