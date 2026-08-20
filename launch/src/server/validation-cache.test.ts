import { describe, expect, it, vi } from "vitest";

vi.mock("./env", () => ({ env: { REDIS_URL: undefined } }));

import { ASSET_VALIDATION_MEMORY_CACHE_MAX_ENTRIES, cachedAssetValidation } from "./validation-cache";

describe("asset validation memory cache", () => {
  it("evicts the oldest entry when the cache reaches its bound", async () => {
    const loads = new Map<number, number>();
    const load = (index: number) => async () => {
      loads.set(index, (loads.get(index) ?? 0) + 1);
      return index;
    };

    for (let index = 0; index <= ASSET_VALIDATION_MEMORY_CACHE_MAX_ENTRIES; index += 1) {
      await cachedAssetValidation(`bounded-${index}`, load(index));
    }

    await cachedAssetValidation("bounded-0", load(0));
    await cachedAssetValidation(`bounded-${ASSET_VALIDATION_MEMORY_CACHE_MAX_ENTRIES}`, load(ASSET_VALIDATION_MEMORY_CACHE_MAX_ENTRIES));

    expect(loads.get(0)).toBe(2);
    expect(loads.get(ASSET_VALIDATION_MEMORY_CACHE_MAX_ENTRIES)).toBe(1);
  });
});
