"use client";

import { useEffect, useState } from "react";
import { managedOtfVaultAbi, otfFactoryAbi } from "@onchaintradedfunds/generated";
import type { Address, PublicClient } from "viem";
import { useChainId, usePublicClient } from "wagmi";
import { robinhoodChainTestnet } from "@/lib/chains";
import { robinhoodTestnetAddresses, robinhoodTestnetCreationReady } from "@/lib/deployment";

export type FactoryVaultSummary = {
  address: Address;
  name: string;
  symbol: string;
  assets: readonly Address[];
  assetCount: number;
  totalSupply: bigint;
  annualCreatorExpenseRatioBps: number;
  creator: Address;
};

export type FactoryVaultDirectoryState = "unavailable" | "loading" | "ready" | "failure";

export async function readVaultSummary(publicClient: PublicClient, address: Address): Promise<FactoryVaultSummary> {
  const [name, symbol, assets, totalSupply, annualCreatorExpenseRatioBps, creator] = await Promise.all([
    publicClient.readContract({ address, abi: managedOtfVaultAbi, functionName: "name" }),
    publicClient.readContract({ address, abi: managedOtfVaultAbi, functionName: "symbol" }),
    publicClient.readContract({ address, abi: managedOtfVaultAbi, functionName: "assets" }),
    publicClient.readContract({ address, abi: managedOtfVaultAbi, functionName: "totalSupply" }),
    publicClient.readContract({ address, abi: managedOtfVaultAbi, functionName: "annualCreatorExpenseRatioBps" }),
    publicClient.readContract({ address, abi: managedOtfVaultAbi, functionName: "creator" }),
  ]);
  return {
    address,
    name,
    symbol,
    assets,
    assetCount: assets.length,
    totalSupply,
    annualCreatorExpenseRatioBps,
    creator,
  };
}

export function useFactoryVaults({ enabled = true }: { enabled?: boolean } = {}) {
  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId });
  const [state, setState] = useState<FactoryVaultDirectoryState>("loading");
  const [vaults, setVaults] = useState<FactoryVaultSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    const factory = robinhoodTestnetAddresses.factory;
    const available = chainId === robinhoodChainTestnet.id && robinhoodTestnetCreationReady && publicClient && factory;
    if (!enabled || !available) {
      setState("unavailable");
      setVaults([]);
      return;
    }

    setState("loading");
    void publicClient.readContract({ address: factory, abi: otfFactoryAbi, functionName: "vaultCount" }).then(async (count) => {
      if (count > 500n) throw new Error("Factory directory exceeds the supported testnet page size.");
      const addresses = await Promise.all(Array.from({ length: Number(count) }, (_, index) => (
        publicClient.readContract({ address: factory, abi: otfFactoryAbi, functionName: "vaultAt", args: [BigInt(index)] })
      )));
      return Promise.all(addresses.reverse().map((vaultAddress) => readVaultSummary(publicClient, vaultAddress)));
    }).then((values) => {
      if (!cancelled) {
        setVaults(values);
        setState("ready");
      }
    }).catch(() => {
      if (!cancelled) {
        setVaults([]);
        setState("failure");
      }
    });

    return () => { cancelled = true; };
  }, [chainId, enabled, publicClient]);

  return { state, vaults };
}
