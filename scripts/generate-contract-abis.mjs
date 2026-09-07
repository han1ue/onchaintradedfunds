import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const generatedPath = resolve(root, "packages", "generated", "src", "index.ts");
const constantsSource = readFileSync(resolve(root, "contracts/src/libraries/ProtocolConstants.sol"), "utf8");
const initialSupplyMatch = constantsSource.match(/uint256 internal constant OTF_INITIAL_SUPPLY = ([\d_]+) ether;/u);
if (!initialSupplyMatch) throw new Error("Missing OTF_INITIAL_SUPPLY constant in ProtocolConstants.sol");
const initialSupply = BigInt(initialSupplyMatch[1].replaceAll("_", "")) * 10n ** 18n;
const contracts = [
  ["ManagedOTFVault", "managedOtfVaultAbi"],
  ["OTFFactory", "otfFactoryAbi"],
  ["OTFEntryExitRouter", "otfEntryExitRouterAbi"],
  ["UniswapV3Adapter", "uniswapV3AdapterAbi"],
  ["UniswapV4Adapter", "uniswapV4AdapterAbi"],
  ["BuybackCollector", "buybackCollectorAbi"],
  ["OTFToken", "otfTokenAbi"],
  ["OTFLaunchManager", "otfLaunchManagerAbi"],
  ["OTFLaunchRouter", "otfLaunchRouterAbi"],
  ["TeamMarketCapVesting", "teamMarketCapVestingAbi"],
  ["MerkleRewardsDistributor", "merkleRewardsDistributorAbi"],
  ["FakeETHUSDOracle", "fakeEthUsdOracleAbi"],
];

function artifact(name) {
  const path = resolve(root, "contracts", "out", `${name}.sol`, `${name}.json`);
  if (!existsSync(path)) {
    throw new Error(`Missing ${path}; run "corepack pnpm contracts:solc" first.`);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

const exports = contracts.map(([contract, exportName]) => {
  const abi = artifact(contract).abi;
  return `export const ${exportName} = ${JSON.stringify(abi, null, 2)} as const;`;
});

writeFileSync(generatedPath, `// Generated from ProtocolConstants.sol.\nexport const OTF_INITIAL_SUPPLY = ${initialSupply}n;\n\n${exports.join("\n\n")}\n`);
console.log(`Generated ${contracts.length} ABI exports in ${generatedPath}.`);
