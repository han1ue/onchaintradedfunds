"use client";

import { useEffect, useState } from "react";
import { otfFactoryAbi } from "@onchaintradedfunds/generated";
import { useChainId, usePublicClient } from "wagmi";
import { protocolDeploymentForChain } from "@/lib/deployment";
import { readVaultSummary, type FactoryVaultSummary } from "./vault-summary";

export { readVaultSummary, type FactoryVaultSummary } from "./vault-summary";

export type FactoryVaultDirectoryState = "unavailable" | "loading" | "ready" | "failure";

export function useFactoryVaults({ enabled = true }: { enabled?: boolean } = {}) {
  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId });
  const [state, setState] = useState<FactoryVaultDirectoryState>("loading");
  const [vaults, setVaults] = useState<FactoryVaultSummary[]>([]);
  const [loadedChainId, setLoadedChainId] = useState(chainId);

  useEffect(() => {
    let cancelled = false;
    setLoadedChainId(chainId);
    const deployment = protocolDeploymentForChain(chainId);
    const factory = deployment?.addresses.factory;
    const available = deployment?.creationReady && publicClient && factory;
    if (!enabled || !available) {
      setState("unavailable");
      setVaults([]);
      return;
    }

    setState("loading");
    setVaults([]);
    void publicClient.readContract({ address: factory, abi: otfFactoryAbi, functionName: "vaultCount" }).then(async (count) => {
      if (count > 500n) throw new Error("Factory directory exceeds the supported page size.");
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

  return loadedChainId === chainId ? { state, vaults } : { state: "loading" as const, vaults: [] };
}
