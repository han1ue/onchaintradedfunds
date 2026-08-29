import { describe, expect, it } from "vitest";
import { navigationItemForPath, operateViewForPath } from "./operate-navigation";

describe("operate navigation", () => {
  it("keeps Swap and Funds navigation aligned with routes", () => {
    expect(navigationItemForPath("/")).toBe("swap");
    expect(navigationItemForPath("/otfs")).toBe("funds");
    expect(navigationItemForPath("/otfs/0x0000000000000000000000000000000000000001")).toBe("funds");
    expect(navigationItemForPath("/create")).toBe("funds");
    expect(navigationItemForPath("/verified")).toBe("funds");
  });

  it("preserves address-routed fund detail paths", () => {
    expect(operateViewForPath("/")).toBe("swap");
    expect(operateViewForPath("/otfs")).toBe("funds");
    expect(operateViewForPath("/otfs/0x0000000000000000000000000000000000000001/manage")).toBe("fund-detail");
    expect(operateViewForPath("/create")).toBe("create");
    expect(operateViewForPath("/verified")).toBe("verified");
    expect(operateViewForPath("/wallet")).toBe("wallet");
  });
});
