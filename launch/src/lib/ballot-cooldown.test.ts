import { describe, expect, it } from "vitest";
import { ballotUpdateCooldownHours, canUpdateBallot, getBallotUpdateAvailableAt } from "./ballot-cooldown";

describe("ballot update cooldown", () => {
  const changedAt = new Date("2026-08-14T12:00:00.000Z");

  it("lasts exactly 24 hours", () => {
    expect(ballotUpdateCooldownHours).toBe(24);
    expect(getBallotUpdateAvailableAt(changedAt).toISOString()).toBe("2026-08-15T12:00:00.000Z");
  });

  it("blocks changes before the cooldown ends", () => {
    expect(canUpdateBallot(changedAt, new Date("2026-08-15T11:59:59.999Z"))).toBe(false);
  });

  it("allows changes when the cooldown ends", () => {
    expect(canUpdateBallot(changedAt, new Date("2026-08-15T12:00:00.000Z"))).toBe(true);
  });
});
