import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const contracts = join(root, "contracts");
const runtimeLimit = 24_576;
const initcodeLimit = 49_152;

function findForge() {
  if (process.env.FORGE_BIN) return process.env.FORGE_BIN;

  const command = process.platform === "win32" ? "where.exe" : "which";
  const discovered = spawnSync(command, ["forge"], { encoding: "utf8" });
  if (discovered.status === 0) return discovered.stdout.trim().split(/\r?\n/)[0];

  const candidates = [
    join(homedir(), ".foundry", "bin", process.platform === "win32" ? "forge.exe" : "forge"),
  ];
  if (process.env.LOCALAPPDATA) {
    const foundryHome = join(process.env.LOCALAPPDATA, "Foundry");
    if (existsSync(foundryHome)) {
      for (const entry of readdirSync(foundryHome).sort().reverse()) {
        candidates.push(join(foundryHome, entry, "forge.exe"));
      }
    }
  }

  const forge = candidates.find(existsSync);
  if (!forge) {
    throw new Error("forge was not found; install Foundry or set FORGE_BIN");
  }
  return forge;
}

const forge = findForge();
const solhint = join(root, "node_modules", "solhint", "solhint.js");

function runForge(args, options = {}) {
  return execFileSync(forge, args, {
    cwd: contracts,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit",
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function byteLength(hex) {
  const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;
  return normalized.length / 2;
}

function artifact(source, contract) {
  return JSON.parse(
    readFileSync(join(contracts, "out", source, `${contract}.json`), "utf8"),
  );
}

function abiSignature(item) {
  return `${item.name}(${item.inputs.map((input) => input.type).join(",")})`;
}

function abiSignatures(compiled, type) {
  return new Set(
    compiled.abi.filter((item) => item.type === type).map(abiSignature),
  );
}

function normalizedStorage(layout) {
  return layout.storage.map((entry) => {
    const type = layout.types[entry.type];
    return {
      label: entry.label,
      slot: entry.slot,
      offset: entry.offset,
      encoding: type.encoding,
      numberOfBytes: type.numberOfBytes,
      typeLabel: type.label.replace(
        /(?:ManagedOTFVault|ManagedOTFVaultStrategy|ManagedOTFVaultView|ManagedOTFVaultStorage)\./g,
        "OTF.",
      ),
    };
  });
}

assert(existsSync(solhint), "solhint is not installed; run corepack pnpm install");
execFileSync(process.execPath, [solhint, "contracts/src/**/*.sol", "--max-warnings", "0"], {
  cwd: root,
  stdio: "inherit",
});

runForge(["build", "--force", "-q"]);
runForge(["lint", "src", "--deny", "warnings"]);

const vaultLayout = normalizedStorage(
  artifact("ManagedOTFVault.sol", "ManagedOTFVault").storageLayout,
);
const strategyLayout = normalizedStorage(
  artifact("ManagedOTFVaultStrategy.sol", "ManagedOTFVaultStrategy").storageLayout,
);
const viewLayout = normalizedStorage(
  artifact("ManagedOTFVaultView.sol", "ManagedOTFVaultView").storageLayout,
);
const canonicalLayout = normalizedStorage(
  artifact("ManagedOTFVaultStorage.sol", "ManagedOTFVaultStorage").storageLayout,
);
assert(
  JSON.stringify(vaultLayout) === JSON.stringify(canonicalLayout),
  "vault declares storage outside the canonical layout",
);
assert(
  JSON.stringify(strategyLayout) === JSON.stringify(canonicalLayout),
  "strategy declares storage outside the canonical layout",
);
assert(
  JSON.stringify(viewLayout) === JSON.stringify(canonicalLayout),
  "view module declares storage outside the canonical layout",
);
const removedDependencyIndex = canonicalLayout.findIndex(
  (entry) => entry.label === "__removedDependencySlot",
);
assert(removedDependencyIndex > 0, "removed dependency slot is not reserved in the clone layout");
assert(
  canonicalLayout[removedDependencyIndex - 1]?.label === "assetRegistry"
    && canonicalLayout[removedDependencyIndex + 1]?.label === "rebalanceExecutor",
  "removed dependency slot moved relative to the deployed clone layout",
);
for (const [label, slot] of [
  ["assetRegistry", "12"],
  ["__removedDependencySlot", "13"],
  ["rebalanceExecutor", "14"],
  ["_pricingConfiguredForAsset", "178"],
  ["_pendingPricingConfigs", "179"],
  ["_primaryMaxStalenessForAsset", "180"],
  ["_quoteTokenForAsset", "181"],
]) {
  assert(
    canonicalLayout.some((entry) => entry.label === label && entry.slot === slot),
    `${label} is not in canonical storage slot ${slot}`,
  );
}

const productionContracts = [
  ["AssetMarketRegistry.sol", "AssetMarketRegistry"],
  ["AssetPricingResolver.sol", "AssetPricingResolver"],
  ["AssetRegistry.sol", "AssetRegistry"],
  ["ChainlinkRoutePriceFeed.sol", "ChainlinkRoutePriceFeed"],
  ["FeeCollector.sol", "FeeCollector"],
  ["ManagedOTFVault.sol", "ManagedOTFVault"],
  ["ManagedOTFVaultStrategy.sol", "ManagedOTFVaultStrategy"],
  ["ManagedOTFVaultView.sol", "ManagedOTFVaultView"],
  ["OTFFactory.sol", "OTFFactory"],
  ["OTFEntryRouter.sol", "OTFEntryRouter"],
  ["OTFV3MarketRegistry.sol", "OTFV3MarketRegistry"],
  ["OTFToken.sol", "OTFToken"],
  ["PortfolioCalculator.sol", "PortfolioCalculator"],
  ["RegisteredUniswapV3Adapter.sol", "RegisteredUniswapV3Adapter"],
  ["RebalanceExecutor.sol", "RebalanceExecutor"],
  ["UniswapV3RoutePriceFeed.sol", "UniswapV3RoutePriceFeed"],
];

for (const [source, name] of productionContracts) {
  const compiled = artifact(source, name);
  const runtime = byteLength(compiled.deployedBytecode.object);
  const initcode = byteLength(compiled.bytecode.object);
  assert(runtime <= runtimeLimit, `${name} runtime is ${runtime} bytes`);
  assert(initcode <= initcodeLimit, `${name} initcode is ${initcode} bytes`);
}

const vault = artifact("ManagedOTFVault.sol", "ManagedOTFVault");
const strategy = artifact("ManagedOTFVaultStrategy.sol", "ManagedOTFVaultStrategy");
const viewModule = artifact("ManagedOTFVaultView.sol", "ManagedOTFVaultView");
const factory = artifact("OTFFactory.sol", "OTFFactory");
const assetRegistry = artifact("AssetRegistry.sol", "AssetRegistry");
const pricingResolver = artifact("AssetPricingResolver.sol", "AssetPricingResolver");
const assetMarketRegistry = artifact("AssetMarketRegistry.sol", "AssetMarketRegistry");
const v3RoutePriceFeed = artifact("UniswapV3RoutePriceFeed.sol", "UniswapV3RoutePriceFeed");
const registeredV3Adapter = artifact(
  "RegisteredUniswapV3Adapter.sol",
  "RegisteredUniswapV3Adapter",
);
const erc7621 = artifact("IERC7621.sol", "IERC7621");
const vaultFunctions = vault.abi.filter((item) => item.type === "function").map((item) => item.name);
const strategyFunctions = strategy.abi
  .filter((item) => item.type === "function")
  .map((item) => item.name);
const factoryFunctions = factory.abi
  .filter((item) => item.type === "function")
  .map((item) => item.name);
const factoryEvents = abiSignatures(factory, "event");
const assetRegistryFunctions = assetRegistry.abi
  .filter((item) => item.type === "function")
  .map((item) => item.name);
const assetRegistryEventNames = assetRegistry.abi
  .filter((item) => item.type === "event")
  .map((item) => item.name);
const pricingResolverFunctions = pricingResolver.abi
  .filter((item) => item.type === "function")
  .map((item) => item.name);
const assetMarketRegistryFunctions = assetMarketRegistry.abi
  .filter((item) => item.type === "function")
  .map((item) => item.name);
const v3RoutePriceFeedFunctions = v3RoutePriceFeed.abi
  .filter((item) => item.type === "function")
  .map((item) => item.name);
const registeredV3AdapterFunctions = registeredV3Adapter.abi
  .filter((item) => item.type === "function")
  .map((item) => item.name);

const officialERC7621Functions = new Map([
  ["contribute(uint256[],address,uint256)", "a1ee8feb"],
  ["getConstituents()", "10d79f4d"],
  ["getReserve(address)", "c9a396e9"],
  ["getWeight(address)", "ac6c5251"],
  ["isConstituent(address)", "6a76d37b"],
  ["previewContribute(uint256[])", "d1602deb"],
  ["previewWithdraw(uint256)", "0a28a477"],
  ["rebalance(address[],uint256[])", "2be01190"],
  ["totalBasketValue()", "28b50621"],
  ["totalConstituents()", "1f39b64e"],
  ["withdraw(uint256,address,uint256[])", "b06c2075"],
]);
const officialERC7621Events = [
  "Contributed(address,address,uint256,uint256[])",
  "Rebalanced(address[],uint256[])",
  "Withdrawn(address,address,uint256,uint256[])",
];
const officialERC7621Errors = [
  "DuplicateConstituent(address)",
  "InsufficientAmount(uint256,uint256,uint256)",
  "InsufficientShares(uint256,uint256)",
  "InvalidWeights(uint256)",
  "LengthMismatch(uint256,uint256)",
  "NotConstituent(address)",
  "ZeroAddress()",
  "ZeroAmount()",
];
const localERC7621Functions = new Map(Object.entries(erc7621.methodIdentifiers));
assert(
  localERC7621Functions.size === officialERC7621Functions.size,
  "IERC7621 function count differs from the pinned official draft",
);
let erc7621InterfaceId = 0n;
for (const [signature, selector] of officialERC7621Functions) {
  assert(
    localERC7621Functions.get(signature) === selector,
    `IERC7621 selector differs for ${signature}`,
  );
  erc7621InterfaceId ^= BigInt(`0x${selector}`);
}
assert(
  erc7621InterfaceId === 0xc9c80f73n,
  `IERC7621 interface ID is 0x${erc7621InterfaceId.toString(16)}, expected 0xc9c80f73`,
);

const localERC7621Events = abiSignatures(erc7621, "event");
const localERC7621Errors = abiSignatures(erc7621, "error");
const vaultMethodIdentifiers = new Map(Object.entries(vault.methodIdentifiers));
const vaultEvents = abiSignatures(vault, "event");
const vaultErrors = abiSignatures(vault, "error");
assert(
  localERC7621Events.size === officialERC7621Events.length,
  "IERC7621 event count differs from the pinned official draft",
);
assert(
  localERC7621Errors.size === officialERC7621Errors.length,
  "IERC7621 error count differs from the pinned official draft",
);
for (const [signature, selector] of officialERC7621Functions) {
  assert(
    vaultMethodIdentifiers.get(signature) === selector,
    `vault is missing ERC-7621 function ${signature}`,
  );
}
for (const signature of officialERC7621Events) {
  assert(localERC7621Events.has(signature), `IERC7621 is missing event ${signature}`);
  assert(vaultEvents.has(signature), `vault is missing ERC-7621 event ${signature}`);
}
for (const signature of officialERC7621Errors) {
  assert(localERC7621Errors.has(signature), `IERC7621 is missing error ${signature}`);
  assert(vaultErrors.has(signature), `vault is missing ERC-7621 error ${signature}`);
}

assert(!vaultFunctions.includes("execute"), "generic execute function found in vault ABI");
for (const legacyFunction of [
  "finalizeTerminalShutdown",
  "proposeStrategyWithMarkets",
]) {
  assert(!vaultFunctions.includes(legacyFunction), `legacy vault function found: ${legacyFunction}`);
}
for (const legacyEvent of [
  "AssetApprovalChanged",
  "AssetBlocked",
  "AssetRemoved",
  "AssetStatusChanged",
]) {
  assert(
    !assetRegistryEventNames.includes(legacyEvent),
    `legacy AssetRegistry event found: ${legacyEvent}`,
  );
}
assert(
  ![...vaultEvents].some((signature) => signature.startsWith("TerminalShutdown")),
  "registry-driven terminal-shutdown event found in vault ABI",
);
for (const legacyFunction of [
  "owner",
  "statusOf",
  "canBeConstituent",
  "isApprovedAsset",
  "isQualifiedAsset",
  "setAssetStatus",
  "setAssetApproved",
  "approveAsset",
  "blockAsset",
  "removeAsset",
]) {
  assert(
    !assetRegistryFunctions.includes(legacyFunction),
    `legacy AssetRegistry authority found: ${legacyFunction}`,
  );
}
assert(assetRegistryFunctions.includes("registerAsset"), "permissionless asset discovery is absent");
assert(
  assetRegistryFunctions.includes("isRegisteredAsset"),
  "permissionless asset discovery view is absent",
);
assert(
  pricingResolverFunctions.includes("validatePricing")
    && pricingResolverFunctions.includes("resolvePricing"),
  "user-supplied pricing resolver surface is absent",
);
assert(
  !pricingResolverFunctions.includes("trustedOracles")
    && !factoryFunctions.includes("oracleRegistry"),
  "removed oracle-registry dependency remains in a production ABI",
);
const pricingResolverConstructor = pricingResolver.abi.find((item) => item.type === "constructor");
assert(
  pricingResolverConstructor?.inputs.length === 2,
  "pricing resolver constructor still depends on an oracle registry",
);
const assetMarketRegistryConstructor = assetMarketRegistry.abi.find(
  (item) => item.type === "constructor",
);
assert(
  assetMarketRegistryConstructor?.inputs.length === 4
    && !assetMarketRegistryFunctions.includes("wethUsdgPool"),
  "V3 pricing still has a deployment-time WETH/USDG pool dependency",
);
assert(
  v3RoutePriceFeedFunctions.includes("quoteUsdFeed")
    && v3RoutePriceFeedFunctions.includes("quoteAssetInUsd")
    && !v3RoutePriceFeedFunctions.includes("wethUsdgPool"),
  "V3 pricing does not pin a quote-token/USD feed independently",
);
assert(
  registeredV3AdapterFunctions.includes("executeSwap"),
  "generic V3 adapter executeSwap surface is absent",
);
assert(
  !registeredV3AdapterFunctions.includes("marketIdFromData"),
  "V3 execution remains coupled to a pricing market ID",
);
assert(
  !registeredV3AdapterFunctions.includes("settlementToken"),
  "generic V3 execution remains coupled to a settlement token",
);
const registeredV3AdapterConstructor = registeredV3Adapter.abi.find(
  (item) => item.type === "constructor",
);
assert(
  registeredV3AdapterConstructor?.inputs.length === 2,
  "generic V3 adapter constructor has unexpected route-policy dependencies",
);
assert(
  factoryFunctions.includes("setVaultDepositsPaused")
    && factoryFunctions.includes("vaultDepositsPaused"),
  "per-vault deposit pause controls are absent",
);
assert(
  factoryEvents.has("VaultDepositsPauseChanged(address,bool)"),
  "per-vault deposit pause event is absent",
);
const createVaultAbi = factory.abi.find(
  (item) => item.type === "function" && item.name === "createVault",
);
const vaultInitComponents = createVaultAbi?.inputs?.[0]?.components ?? [];
assert(
  vaultInitComponents.some((component) => component.name === "initialPricingConfigs"),
  "factory createVault tuple does not accept initialPricingConfigs",
);
assert(
  !vaultInitComponents.some((component) => component.name === "initialMarketIds"),
  "factory createVault tuple still accepts initialMarketIds",
);
const vaultTypesSource = readFileSync(join(contracts, "src", "VaultTypes.sol"), "utf8");
assert(!/UniswapV4|PricingSource[^}]*V4/su.test(vaultTypesSource), "V4 pricing source found");
assert(!strategyFunctions.includes("initialize"), "strategy initializer found");
assert(
  !strategyFunctions.some((name) => /upgrade|implementation/i.test(name)),
  "upgrade surface found in strategy ABI",
);
assert(vaultFunctions.includes("strategyModule"), "strategy module identity is not exposed");
assert(
  vaultFunctions.includes("strategyModuleCodehash"),
  "strategy module codehash is not exposed",
);
assert(vaultFunctions.includes("viewModule"), "view module identity is not exposed");
assert(vaultFunctions.includes("viewModuleCodehash"), "view module codehash is not exposed");

for (const item of viewModule.abi) {
  assert(
    item.type !== "fallback" && item.type !== "receive",
    `view module exposes a ${item.type} entry point`,
  );
  if (item.type !== "function") continue;
  assert(
    item.stateMutability === "view" || item.stateMutability === "pure",
    `view-module function is mutative: ${abiSignature(item)}`,
  );
}

console.log(
  `Contract security checks passed: ERC-7621 ID 0x${erc7621InterfaceId.toString(16)}, ${canonicalLayout.length} canonical storage entries, and ${productionContracts.length} production bytecode limits verified.`,
);
