export const ballotUpdateCooldownHours = 24;
export const ballotUpdateCooldownMs = ballotUpdateCooldownHours * 60 * 60 * 1_000;

export function getBallotUpdateAvailableAt(lastUpdatedAt: Date | string) {
  return new Date(new Date(lastUpdatedAt).getTime() + ballotUpdateCooldownMs);
}

export function canUpdateBallot(lastUpdatedAt: Date | string, now: Date = new Date()) {
  return now.getTime() >= getBallotUpdateAvailableAt(lastUpdatedAt).getTime();
}
