import { decodeAbiParameters, decodeFunctionData, getAddress } from "viem";
import { describe, expect, it } from "vitest";
import {
  canonicalV4Execution,
  ROUTER_ADDRESS_THIS,
  ROUTER_MSG_SENDER,
  UNIVERSAL_ROUTER_EXECUTE_ABI,
} from "./canonical-v4-execution";

const WETH = getAddress("0x00000000000000000000000000000000000000a1");
const OTF = getAddress("0x00000000000000000000000000000000000000b2");
const LAUNCH = getAddress("0x00000000000000000000000000000000000000c3");

describe("canonical native V4 execution", () => {
  it("wraps exact ETH before V4 SETTLE and TAKE", () => {
    const plan = canonicalV4Execution({ tokenIn: WETH, tokenOut: OTF, amountIn: 10n, amountOutMinimum: 8n, launchManager: LAUNCH, deadline: 100n, nativeInput: true, nativeOutput: false });
    const decoded = decodeFunctionData({ abi: UNIVERSAL_ROUTER_EXECUTE_ABI, data: plan.data });
    expect(decoded.args[0]).toBe("0x0b10");
    expect(plan.value).toBe(10n);
    expect(decodeAbiParameters([{ type: "address" }, { type: "uint256" }], decoded.args[1][0]!)).toEqual([ROUTER_ADDRESS_THIS, 10n]);
    const [actions, parameters] = decodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], plan.routerInput);
    expect(actions).toBe("0x070b0e");
    expect(decodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "bool" }], parameters[1]!)).toEqual([WETH, 10n, false]);
    expect(decodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint256" }], parameters[2]!)).toEqual([OTF, ROUTER_MSG_SENDER, 0n]);
  });

  it("takes WETH to the router and unwraps before payout", () => {
    const plan = canonicalV4Execution({ tokenIn: OTF, tokenOut: WETH, amountIn: 10n, amountOutMinimum: 8n, launchManager: LAUNCH, deadline: 100n, nativeInput: false, nativeOutput: true });
    const decoded = decodeFunctionData({ abi: UNIVERSAL_ROUTER_EXECUTE_ABI, data: plan.data });
    expect(decoded.args[0]).toBe("0x100c");
    expect(plan.value).toBe(0n);
    const [actions, parameters] = decodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], plan.routerInput);
    expect(actions).toBe("0x070b0e");
    expect(decodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "bool" }], parameters[1]!)).toEqual([OTF, 10n, true]);
    expect(decodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint256" }], parameters[2]!)).toEqual([WETH, ROUTER_ADDRESS_THIS, 0n]);
    expect(decodeAbiParameters([{ type: "address" }, { type: "uint256" }], decoded.args[1][1]!)).toEqual([ROUTER_MSG_SENDER, 8n]);
  });
});
