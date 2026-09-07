import { afterEach, describe, expect, it, vi } from "vitest";
import { createUniswapProviderRequest } from "./uniswap-provider";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("Uniswap provider pacing", () => {
  it("spaces concurrent basket and approval requests below six requests per second", async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const starts: number[] = [];
    vi.stubGlobal("fetch", vi.fn(async () => { starts.push(Date.now()); return Response.json({ ok: true }); }));
    const request = createUniswapProviderRequest();
    const results = Promise.all(Array.from({ length: 8 }, (_, index) => request(index % 2 ? "quote" : "check_approval", {}, "test-key")));
    await vi.runAllTimersAsync(); await results;
    expect(starts).toEqual([0, 210, 420, 630, 840, 1050, 1260, 1470]);
  });
  it("honors Retry-After before retrying a 429", async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const starts: number[] = [];
    vi.stubGlobal("fetch", vi.fn(async () => {
      starts.push(Date.now());
      return starts.length === 1 ? new Response(null, { status: 429, headers: { "retry-after": "2" } }) : Response.json({ ok: true });
    }));
    const result = createUniswapProviderRequest()("quote", {}, "test-key");
    await vi.runAllTimersAsync(); expect(await result).toEqual({ ok: true });
    expect(starts).toEqual([0, 2000]);
  });
  it("stops after three rate-limited attempts and does not retry missing routes", async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const fetcher = vi.fn(async () => new Response(null, { status: 429 }));
    vi.stubGlobal("fetch", fetcher);
    const result = createUniswapProviderRequest()("quote", {}, "test-key").catch((error) => error);
    await vi.runAllTimersAsync(); expect(await result).toMatchObject({ code: "PROVIDER_RATE_LIMITED" });
    expect(fetcher).toHaveBeenCalledTimes(3);
    fetcher.mockClear().mockImplementation(async () => new Response(null, { status: 404 }));
    const missing = createUniswapProviderRequest()("quote", {}, "test-key").catch((error) => error);
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
    const request = createUniswapProviderRequest();
    const results = Promise.all([request("quote", {}, "test-key"), request("quote", {}, "test-key")]);
    await vi.runAllTimersAsync(); await results;
    expect(starts).toEqual([0, 2000, 2210]);
  });
});
