import { describe, expect, it } from "vitest";
import { formatProposalAge } from "./relative-time";

const now = new Date("2026-08-15T12:00:00Z");

describe("formatProposalAge", () => {
  it("describes proposals less than an hour old", () => {
    expect(formatProposalAge("2026-08-15T11:30:00Z", now)).toBe("Proposed less than an hour ago");
  });

  it("uses singular and plural hours", () => {
    expect(formatProposalAge("2026-08-15T10:30:00Z", now)).toBe("Proposed 1 hour ago");
    expect(formatProposalAge("2026-08-14T13:00:00Z", now)).toBe("Proposed 23 hours ago");
  });

  it("switches to days after 24 hours", () => {
    expect(formatProposalAge("2026-08-14T12:00:00Z", now)).toBe("Proposed 1 day ago");
    expect(formatProposalAge("2026-08-13T11:00:00Z", now)).toBe("Proposed 2 days ago");
  });
});
