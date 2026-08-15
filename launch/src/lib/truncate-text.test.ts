import { describe, expect, it } from "vitest";
import { truncateText } from "./truncate-text";

describe("truncateText", () => {
  it("leaves text within the limit unchanged", () => {
    expect(truncateText("Long-term growth", 20)).toBe("Long-term growth");
  });

  it("keeps the preview within the requested character limit", () => {
    const preview = truncateText("A thesis that is longer than the leaderboard preview allows", 20);

    expect(preview).toBe("A thesis that is lo…");
    expect(Array.from(preview)).toHaveLength(20);
  });

  it("counts emoji as single displayed characters", () => {
    expect(truncateText("AI 🤖 infrastructure", 6)).toBe("AI 🤖…");
  });
});
