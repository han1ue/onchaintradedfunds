import { describe, expect, it } from "vitest";
import {
  formatProposalVoteCountdown,
  getProposalVotingStartsAt,
  isProposalVotingOpen,
} from "./proposal-voting";

const acceptedAt = new Date("2026-08-19T12:00:00.000Z");

describe("proposal voting delay", () => {
  it("opens exactly 30 minutes after confirmation", () => {
    expect(getProposalVotingStartsAt(acceptedAt).toISOString()).toBe("2026-08-19T12:30:00.000Z");
    expect(isProposalVotingOpen(acceptedAt, new Date("2026-08-19T12:29:59.999Z"))).toBe(false);
    expect(isProposalVotingOpen(acceptedAt, new Date("2026-08-19T12:30:00.000Z"))).toBe(true);
  });

  it("formats a stable minute-and-second countdown and clamps at zero", () => {
    expect(formatProposalVoteCountdown(acceptedAt, new Date("2026-08-19T12:00:00.000Z"))).toBe("30:00");
    expect(formatProposalVoteCountdown(acceptedAt, new Date("2026-08-19T12:29:01.250Z"))).toBe("00:59");
    expect(formatProposalVoteCountdown(acceptedAt, new Date("2026-08-19T12:31:00.000Z"))).toBe("00:00");
  });
});
