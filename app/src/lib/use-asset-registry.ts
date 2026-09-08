"use client";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useChainId } from "wagmi";
import { assetCatalog, emptyRegistry, type AssetRegistry } from "./asset-catalog";

export function useAssetRegistry() {
  const chainId = useChainId();
  const query = useQuery({
    queryKey: ["asset-registry", chainId], staleTime: 60_000, retry: 1,
    queryFn: async ({ signal }): Promise<AssetRegistry> => {
      const response = await fetch(`/api/asset-registry?chainId=${chainId}&includeUnverified=true`, { signal });
      if (!response.ok) throw new Error("Asset registry unavailable. Refresh to try again.");
      return response.json();
    },
  });
  const registry = query.data ?? emptyRegistry;
  const catalog = useMemo(() => assetCatalog(registry, chainId), [registry, chainId]);
  return { ...query, registry, catalog };
}
