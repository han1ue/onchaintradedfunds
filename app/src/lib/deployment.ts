import deployment from "@/config/robinhood-testnet.json";
import { getAddress, isAddress, type Address } from "viem";

type ContractDeployment = { address?: unknown };

const contracts = deployment.contracts as Record<string, ContractDeployment | undefined>;
const externalContracts = deployment.externalContracts as Record<string, unknown>;

function address(value: unknown): Address | undefined {
  return typeof value === "string" && isAddress(value) ? getAddress(value) : undefined;
}

function deployedContract(name: string): Address | undefined {
  return address(contracts[name]?.address);
}

export const robinhoodTestnetAddresses = Object.freeze({
  assetRegistry: deployedContract("assetRegistry"),
  oracleRegistry: deployedContract("oracleRegistry"),
  rebalanceExecutor: deployedContract("rebalanceExecutor"),
  feeCollector: deployedContract("feeCollector"),
  vaultImplementation: deployedContract("vaultImplementation"),
  factory: deployedContract("factory"),
  entryRouter: deployedContract("entryRouter"),
  uniswapV2Adapter: deployedContract("uniswapAdapter"),
  v3MarketRegistry: deployedContract("v3MarketRegistry"),
  usdg: address(externalContracts.usdg),
  uniswapV2Router: address(externalContracts.uniswapV2Router),
  uniswapV3Factory: address(externalContracts.uniswapV3Factory),
  uniswapV3PositionManager: address(externalContracts.uniswapV3PositionManager),
  uniswapV3SwapRouter: address(externalContracts.uniswapV3SwapRouter),
  uniswapV3Quoter: address(externalContracts.uniswapV3Quoter),
});
