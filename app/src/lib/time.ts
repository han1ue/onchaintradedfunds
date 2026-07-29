export function formatCooldown(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "Not configured";

  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days} ${days === 1 ? "day" : "days"}`);
  if (hours > 0) parts.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
  if (days === 0 && minutes > 0) {
    parts.push(`${minutes} ${minutes === 1 ? "minute" : "minutes"}`);
  }

  return parts.length > 0 ? parts.join(", ") : `${seconds} seconds`;
}

export function formatTimestamp(seconds?: number): string {
  if (!seconds) return "Not available";

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(seconds * 1_000));
}

export function formatRelativeAvailability(seconds?: number): string {
  if (!seconds) return "Awaiting vault data";

  const delta = seconds - Math.floor(Date.now() / 1_000);
  if (delta <= 0) return "Available now";
  if (delta < 60) return `${delta} seconds remaining`;

  const days = Math.floor(delta / 86_400);
  const hours = Math.floor((delta % 86_400) / 3_600);
  const minutes = Math.floor((delta % 3_600) / 60);

  if (days > 0) return `${days}d ${hours}h remaining`;
  if (hours > 0) return `${hours}h ${minutes}m remaining`;
  return `${minutes}m remaining`;
}

export function progressThroughCooldown(
  lastPortfolioChange?: number,
  nextPortfolioChange?: number,
): number {
  if (!lastPortfolioChange || !nextPortfolioChange || nextPortfolioChange <= lastPortfolioChange) {
    return 0;
  }

  const now = Math.floor(Date.now() / 1_000);
  const elapsed = now - lastPortfolioChange;
  const total = nextPortfolioChange - lastPortfolioChange;
  return Math.max(0, Math.min(100, Math.round((elapsed / total) * 100)));
}
