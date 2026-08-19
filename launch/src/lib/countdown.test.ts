import { describe, expect, it } from "vitest";
import { formatCountdown } from "./countdown";

describe("competition countdown", () => {
  it("formats full and compact countdowns", () => {
    const remainingMs = ((6 * 24 + 23) * 60 + 8) * 60 * 1_000 + 9_000;
    expect(formatCountdown(remainingMs)).toBe("6d 23h 8m 9s");
    expect(formatCountdown(remainingMs, true)).toBe("6d 23h");
  });

  it("rounds up the final partial second and clamps at zero", () => {
    expect(formatCountdown(1)).toBe("0m 1s");
    expect(formatCountdown(0)).toBe("Open now");
    expect(formatCountdown(-1_000)).toBe("Open now");
  });
});
