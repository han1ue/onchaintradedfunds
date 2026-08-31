import { describe, expect, it } from "vitest";
import { navigationItemForPath } from "./operate-navigation";

describe("operate navigation", () => {
  it("keeps Swap and Funds navigation aligned with routes", () => {
    expect(navigationItemForPath("/")).toBe("swap");
    expect(navigationItemForPath("/funds")).toBe("funds");
    expect(navigationItemForPath("/funds/0x0000000000000000000000000000000000000001")).toBe("funds");
    expect(navigationItemForPath("/create")).toBe("funds");
    expect(navigationItemForPath("/verified")).toBe("funds");
    expect(navigationItemForPath("/token")).toBe("token");
    expect(navigationItemForPath("/wallet")).toBeUndefined();
    expect(navigationItemForPath("/liquidity")).toBeUndefined();
  });
});
