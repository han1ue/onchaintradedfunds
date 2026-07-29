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

