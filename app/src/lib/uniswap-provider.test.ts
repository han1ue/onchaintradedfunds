import { afterEach, describe, expect, it, vi } from "vitest";
import { createUniswapProviderRequest } from "./uniswap-provider";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
function sharedCoordinator() {
  let next=0,cooldown=0;
  return async (_key: string, until=0) => {
    cooldown=Math.max(cooldown,until);
    const wait=Math.max(next,cooldown)-Date.now();
    if(until) return Math.max(0,wait);
    if(wait>0)return wait;
    next=Date.now()+210;return 0;
  };
}
describe("Uniswap provider pacing", () => {
  it("spaces concurrent quote and swap requests below six requests per second", async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const starts: number[] = [];
    vi.stubGlobal("fetch", vi.fn(async () => { starts.push(Date.now()); return Response.json({ ok: true }); }));
    const coordinator=sharedCoordinator();
    const instances=[createUniswapProviderRequest(coordinator),createUniswapProviderRequest(coordinator)];
    const results = Promise.all(Array.from({ length: 8 }, (_, index) => instances[index % 2](index % 2 ? "quote" : "swap", {}, "test-key")));
    await vi.runAllTimersAsync(); await results;
    expect(starts).toEqual([0, 210, 420, 630, 840, 1050, 1260, 1470]);
    expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headers: expect.objectContaining({ "x-universal-router-version": "2.1.1" }),
    }));
  });
  it("honors Retry-After before retrying a 429", async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const starts: number[] = [];
    vi.stubGlobal("fetch", vi.fn(async () => {
      starts.push(Date.now());
      return starts.length === 1 ? new Response(null, { status: 429, headers: { "retry-after": "2" } }) : Response.json({ ok: true });
    }));
    const result = createUniswapProviderRequest(sharedCoordinator())("quote", {}, "test-key");
    await vi.runAllTimersAsync(); expect(await result).toEqual({ ok: true });
    expect(starts).toEqual([0, 2000]);
  });
  it("stops after three rate-limited attempts and does not retry missing routes", async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const fetcher = vi.fn(async () => new Response(null, { status: 429 }));
    vi.stubGlobal("fetch", fetcher);
    const result = createUniswapProviderRequest(sharedCoordinator())("quote", {}, "test-key").catch((error) => error);
    await vi.runAllTimersAsync(); expect(await result).toMatchObject({ code: "PROVIDER_RATE_LIMITED" });
    expect(fetcher).toHaveBeenCalledTimes(3);
    fetcher.mockClear().mockImplementation(async () => new Response(null, { status: 404 }));
    const missing = createUniswapProviderRequest(sharedCoordinator())("quote", {}, "test-key").catch((error) => error);
    await vi.runAllTimersAsync(); expect(await missing).toMatchObject({ code: "NO_ROUTE" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("applies a provider cooldown to calls already waiting for a slot", async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const starts: number[] = [];
    vi.stubGlobal("fetch", vi.fn(async () => {
      starts.push(Date.now());
      return starts.length === 1 ? new Response(null, { status: 429, headers: { "retry-after": "2" } }) : Response.json({ ok: true });
    }));
    const request = createUniswapProviderRequest(sharedCoordinator());
    const results = Promise.all([request("quote", {}, "test-key"), request("quote", {}, "test-key")]);
    await vi.runAllTimersAsync(); await results;
    expect(starts).toEqual([0, 2000, 2210]);
  });
});
