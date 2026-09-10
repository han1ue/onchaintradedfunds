import { describe, expect, it, vi } from "vitest";
import { delegates, verifyImmutableDeployment } from "./deployment-verification";

describe("immutable deployment verification",()=>{
  it("reuses a successful check only for the same configuration and runtime",async()=>{
    const verify=vi.fn(async()=>{});
    await verifyImmutableDeployment("chain:rpc:addresses",["0x6000"],verify);
    await verifyImmutableDeployment("chain:rpc:addresses",["0x6000"],verify);
    expect(verify).toHaveBeenCalledOnce();
    await verifyImmutableDeployment("chain:rpc:addresses",["0x6001"],verify);
    await verifyImmutableDeployment("chain:other-rpc:addresses",["0x6000"],verify);
    expect(verify).toHaveBeenCalledTimes(3);
  });
  it("does not cache failed verification or dependencies with delegation",async()=>{
    const verify=vi.fn(async()=>{}).mockRejectedValueOnce(new Error("binding mismatch"));
    await expect(verifyImmutableDeployment("failed",["0x6000"],verify)).rejects.toThrow();
    await verifyImmutableDeployment("failed",["0x6000"],verify);
    await verifyImmutableDeployment("proxy",["0x6000f4"],verify);
    await verifyImmutableDeployment("proxy",["0x6000f4"],verify);
    expect(verify).toHaveBeenCalledTimes(4);
    expect(delegates("0x60f400")).toBe(false);
    expect(delegates("0xef0100")).toBe(true);
  });
});
