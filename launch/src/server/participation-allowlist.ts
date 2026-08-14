const participationXUserIdAllowlist = new Set([
  "2027340342585077760", // @PermaUpperClass
]);

export function isParticipationAllowlistedXUserId(xUserId: string | null | undefined) {
  return participationXUserIdAllowlist.has(xUserId?.trim() ?? "");
}
