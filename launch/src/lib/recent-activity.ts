export function selectRecentProposals<T extends { acceptedAt: string }>(proposals: T[], limit = 3) {
  return [...proposals]
    .sort((left, right) => new Date(right.acceptedAt).getTime() - new Date(left.acceptedAt).getTime())
    .slice(0, limit);
}
