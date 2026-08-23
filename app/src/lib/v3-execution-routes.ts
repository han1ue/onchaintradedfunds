"use client";

import { useMemo } from "react";
import { getAddress, isAddress, zeroAddress, type Address } from "viem";
import { useReadContracts } from "wagmi";
import { robinhoodChainTestnet } from "./chains";
import { robinhoodTestnetAddresses } from "./deployment";

export const V3_EXECUTION_FEES = [100, 500, 3_000, 10_000] as const;

const factoryAbi = [{
  type: "function",
  name: "getPool",
  stateMutability: "view",
  inputs: [
    { name: "tokenA", type: "address" },
    { name: "tokenB", type: "address" },
    { name: "fee", type: "uint24" },
  ],
  outputs: [{ name: "pool", type: "address" }],
}] as const;

const poolAbi = [{
  type: "function",
  name: "liquidity",
  stateMutability: "view",
  inputs: [],
  outputs: [{ name: "liquidity", type: "uint128" }],
}] as const;

export type V3TokenPair = {
  tokenA: string;
  tokenB: string;
};

export type DiscoveredV3Pool = {
  address: Address;
  tokenA: Address;
  tokenB: Address;
  fee: number;
  liquidity: bigint | undefined;
  readFailed: boolean;
};

export type DiscoveredExecutionRoute = {
  asset: Address;
  settlementToken: Address;
  quoteToken: Address;
  assetPool: DiscoveredV3Pool;
  bridgePool?: DiscoveredV3Pool;
};

function pairKey(tokenA: string, tokenB: string): string {
  return [tokenA.toLowerCase(), tokenB.toLowerCase()].sort().join(":");
}

export function poolConnects(pool: DiscoveredV3Pool, tokenA: string, tokenB: string): boolean {
  return pairKey(pool.tokenA, pool.tokenB) === pairKey(tokenA, tokenB);
}

export function selectV3Pool(
  pools: DiscoveredV3Pool[],
  tokenA: string,
  tokenB: string,
): DiscoveredV3Pool | undefined {
  return pools
    .filter((pool) => poolConnects(pool, tokenA, tokenB))
    .sort((left, right) => {
      const leftLiquidity = left.liquidity ?? -1n;
      const rightLiquidity = right.liquidity ?? -1n;
      if (leftLiquidity !== rightLiquidity) return leftLiquidity > rightLiquidity ? -1 : 1;
      return left.fee - right.fee;
    })[0];
}

export function selectExecutionRoute(
  pools: DiscoveredV3Pool[],
  asset: string,
  settlementToken: string,
  alternateQuoteToken?: string,
): DiscoveredExecutionRoute | undefined {
  if (!isAddress(asset) || !isAddress(settlementToken)) return undefined;
  const normalizedAsset = getAddress(asset);
  const normalizedSettlement = getAddress(settlementToken);
  if (normalizedAsset.toLowerCase() === normalizedSettlement.toLowerCase()) return undefined;

  const directPool = selectV3Pool(pools, normalizedAsset, normalizedSettlement);
  const directReady = directPool?.liquidity !== undefined && directPool.liquidity > 0n && !directPool.readFailed;
  const alternate = alternateQuoteToken && isAddress(alternateQuoteToken)
    ? getAddress(alternateQuoteToken)
    : undefined;
  const assetPool = alternate ? selectV3Pool(pools, normalizedAsset, alternate) : undefined;
  const bridgePool = alternate ? selectV3Pool(pools, alternate, normalizedSettlement) : undefined;
  const bridgedReady = assetPool?.liquidity !== undefined && assetPool.liquidity > 0n && !assetPool.readFailed
    && bridgePool?.liquidity !== undefined && bridgePool.liquidity > 0n && !bridgePool.readFailed;

  if (directPool && (directReady || !bridgedReady)) {
    return {
      asset: normalizedAsset,
      settlementToken: normalizedSettlement,
      quoteToken: normalizedSettlement,
      assetPool: directPool,
    };
  }
  if (alternate && assetPool && bridgePool) {
    return {
      asset: normalizedAsset,
      settlementToken: normalizedSettlement,
      quoteToken: alternate,
      assetPool,
      bridgePool,
    };
  }
  return undefined;
}

export function useDiscoveredV3Pools(pairs: V3TokenPair[], enabled: boolean) {
  const factory = robinhoodTestnetAddresses.uniswapV3Factory;
  const normalizedPairs = useMemo(() => {
    const unique = new Map<string, { tokenA: Address; tokenB: Address }>();
    pairs.forEach(({ tokenA, tokenB }) => {
      if (!isAddress(tokenA) || !isAddress(tokenB) || tokenA.toLowerCase() === tokenB.toLowerCase()) return;
      const normalized = { tokenA: getAddress(tokenA), tokenB: getAddress(tokenB) };
      unique.set(pairKey(normalized.tokenA, normalized.tokenB), normalized);
    });
    return [...unique.values()];
  }, [pairs]);
  const lookups = useMemo(
    () => normalizedPairs.flatMap((pair) => V3_EXECUTION_FEES.map((fee) => ({ ...pair, fee }))),
    [normalizedPairs],
  );
  const lookupEnabled = Boolean(enabled && factory && lookups.length);
  const {
    data: lookupResults,
    isLoading: lookupLoading,
    isError: lookupError,
  } = useReadContracts({
    contracts: lookups.map((lookup) => ({
      address: factory!,
      abi: factoryAbi,
      functionName: "getPool" as const,
      args: [lookup.tokenA, lookup.tokenB, lookup.fee] as const,
      chainId: robinhoodChainTestnet.id,
    })),
    query: { enabled: lookupEnabled, refetchOnWindowFocus: true },
  });
  const candidates = lookups.flatMap((lookup, index) => {
    const result = lookupResults?.[index];
    const address = result?.status === "success" ? result.result : undefined;
    return address && address !== zeroAddress
      ? [{ ...lookup, address: getAddress(address) }]
      : [];
  });
  const {
    data: liquidityResults,
    isLoading: liquidityLoading,
    isError: liquidityError,
  } = useReadContracts({
    contracts: candidates.map((candidate) => ({
      address: candidate.address,
      abi: poolAbi,
      functionName: "liquidity" as const,
      chainId: robinhoodChainTestnet.id,
    })),
    query: { enabled: enabled && candidates.length > 0, refetchOnWindowFocus: true },
  });
  const pools = candidates.map((candidate, index): DiscoveredV3Pool => {
    const result = liquidityResults?.[index];
    return {
      ...candidate,
      liquidity: result?.status === "success" ? result.result : undefined,
      readFailed: result?.status === "failure",
    };
  });

  return {
    pools,
    isLoading: lookupLoading || liquidityLoading,
    isError: lookupError || liquidityError,
    discoveryComplete: !lookupEnabled || (!lookupLoading && !liquidityLoading),
  };
}
