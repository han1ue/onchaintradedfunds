const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export function formatProposalAge(proposedAt: string | Date, now = new Date()) {
  const elapsedMs = Math.max(0, now.getTime() - new Date(proposedAt).getTime());

  if (elapsedMs < HOUR_MS) return "Proposed less than an hour ago";

  if (elapsedMs < DAY_MS) {
    const hours = Math.floor(elapsedMs / HOUR_MS);
    return `Proposed ${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  }

  const days = Math.floor(elapsedMs / DAY_MS);
  return `Proposed ${days} ${days === 1 ? "day" : "days"} ago`;
}
