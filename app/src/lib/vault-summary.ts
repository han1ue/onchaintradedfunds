import { managedOtfVaultAbi } from "@onchaintradedfunds/generated";
import type { Address, PublicClient } from "viem";

export type FactoryVaultSummary = {
  address: Address;
  name: string;
  symbol: string;
  fundThesis: string;
  assets: readonly Address[];
  assetCount: number;
  totalSupply: bigint;
  annualCreatorExpenseRatioBps: number;
  creator: Address;
};

export async function readVaultSummary(publicClient: PublicClient, address: Address): Promise<FactoryVaultSummary> {
  const [name, symbol, fundThesis, assets, totalSupply, annualCreatorExpenseRatioBps, creator] = await Promise.all([
    publicClient.readContract({ address, abi: managedOtfVaultAbi, functionName: "name" }),
    publicClient.readContract({ address, abi: managedOtfVaultAbi, functionName: "symbol" }),
    publicClient.readContract({ address, abi: managedOtfVaultAbi, functionName: "fundThesis" }),
    publicClient.readContract({ address, abi: managedOtfVaultAbi, functionName: "assets" }),
    publicClient.readContract({ address, abi: managedOtfVaultAbi, functionName: "totalSupply" }),
    publicClient.readContract({ address, abi: managedOtfVaultAbi, functionName: "annualCreatorExpenseRatioBps" }),
    publicClient.readContract({ address, abi: managedOtfVaultAbi, functionName: "creator" }),
  ]);
  return {
    address,
    name,
    symbol,
    fundThesis,
    assets,
    assetCount: assets.length,
    totalSupply,
    annualCreatorExpenseRatioBps,
    creator,
  };
}
