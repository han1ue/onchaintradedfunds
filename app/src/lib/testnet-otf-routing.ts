import { otfLaunchManagerAbi } from "@onchaintradedfunds/generated";
import { decodeFunctionResult, encodeFunctionData, parseAbi, type Address, type PublicClient } from "viem";
import { robinhoodTestnetAddresses, robinhoodTestnetV4, robinhoodTestnetUniversalAdapterReady } from "./deployment";
import { sameAddress } from "./basket-planner";

export const otfQuoterAbi = parseAbi([
  "function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)",
  "function quoteExactOutputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountIn,uint256 gasEstimate)",
]);
const bindings = parseAbi([
  "function entryExitRouter() view returns (address)",
  "function weth() view returns (address)",
  "function uniswapV4PoolManager() view returns (address)",
  "function uniswapV4StateView() view returns (address)",
  "function uniswapUniversalRouter() view returns (address)",
  "function permit2() view returns (address)",
  "function poolManager() view returns (address)",
  "function isAdapterApproved(address) view returns (bool)",
]);

export function testnetOtfRouting(client: Pick<PublicClient, "readContract" | "call">) {
  let verified: Promise<void> | undefined;
  const { otfToken, weth, launchManager, uniswapUniversalRouterAdapter, entryRouter } = robinhoodTestnetAddresses;
  const verify = async (router: Address, adapter: Address) => {
    if (!robinhoodTestnetUniversalAdapterReady || !entryRouter || !uniswapUniversalRouterAdapter || !launchManager || !weth || !otfToken || !robinhoodTestnetV4.quoter
      || !sameAddress(router, entryRouter) || !sameAddress(adapter, uniswapUniversalRouterAdapter)) throw new Error("The OTF basket adapter is unavailable.");
    const checks = [
      [adapter, "entryExitRouter", router], [adapter, "weth", weth],
      [adapter, "uniswapV4PoolManager", robinhoodTestnetV4.poolManager!],
      [adapter, "uniswapV4StateView", robinhoodTestnetV4.stateView!],
      [adapter, "uniswapUniversalRouter", robinhoodTestnetV4.universalRouter!],
      [adapter, "permit2", robinhoodTestnetV4.permit2!],
      [robinhoodTestnetV4.quoter, "poolManager", robinhoodTestnetV4.poolManager!],
      [robinhoodTestnetV4.stateView!, "poolManager", robinhoodTestnetV4.poolManager!],
      [robinhoodTestnetV4.universalRouter!, "poolManager", robinhoodTestnetV4.poolManager!],
    ] as const;
    await Promise.all(checks.map(async ([address, functionName, expected]) => {
      const actual = await client.readContract({ address, abi: bindings, functionName });
      if (!sameAddress(actual, expected)) throw new Error(`Invalid OTF adapter ${functionName} binding.`);
    }));
    if (!await client.readContract({ address: router, abi: bindings, functionName: "isAdapterApproved", args: [adapter] })) throw new Error("The OTF basket adapter is not approved.");
    const key = await client.readContract({ address: launchManager, abi: otfLaunchManagerAbi, functionName: "poolKey" });
    const ordered = [otfToken, weth].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1);
    if (!sameAddress(key[0], ordered[0]!) || !sameAddress(key[1], ordered[1]!) || key[2] !== 0 || key[3] !== 1 || !sameAddress(key[4], launchManager)) throw new Error("Invalid canonical OTF pool.");
  };
  return {
    verifyOtfBindings(router: Address, adapter: Address) {
      return verified ??= verify(router, adapter);
    },
    async quoteOtf(type: "EXACT_INPUT" | "EXACT_OUTPUT", buy: boolean, amount: bigint) {
      if (!verified) throw new Error("OTF pool bindings have not been checked.");
      await verified;
      if (amount <= 0n || amount > (1n << 128n) - 1n) throw new Error("OTF quote amount exceeds adapter limits.");
      const [currency0, currency1] = [otfToken!, weth!].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1);
      const functionName = type === "EXACT_INPUT" ? "quoteExactInputSingle" : "quoteExactOutputSingle";
      const data = encodeFunctionData({ abi: otfQuoterAbi, functionName, args: [{
        poolKey: { currency0: currency0!, currency1: currency1!, fee: 0, tickSpacing: 1, hooks: launchManager! },
        zeroForOne: sameAddress(buy ? weth! : otfToken!, currency0!), exactAmount: amount, hookData: "0x",
      }] });
      const result = await client.call({ to: robinhoodTestnetV4.quoter!, data });
      if (!result.data) throw new Error("The OTF quoter returned no data.");
      const [quoted] = decodeFunctionResult({ abi: otfQuoterAbi, functionName, data: result.data });
      if (quoted <= 0n) throw new Error("The OTF pool has no quote for this amount.");
      return quoted;
    },
  };
}
