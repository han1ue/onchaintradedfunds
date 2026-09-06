import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";
import { assertTestnetRoutingConfiguration } from "./lib/testnet-routing.mjs";

const root = resolve(import.meta.dirname, "..");
const contracts = join(root, "contracts");
const runtimeLimit = 24_576;
const initcodeLimit = 49_152;
const production = [
  "ManagedOTFVault", "OTFFactory", "OTFEntryExitRouter", "UniswapV3Adapter", "UniswapV4Adapter",
  "OTFToken", "OTFLaunchManager", "OTFLaunchManagerDeployer", "OTFLaunchRouter", "TeamMarketCapVesting",
  "BuybackCollector", "MerkleRewardsDistributor", "FakeETHUSDOracle",
];
const forbiddenArtifactName = /FeeCollector|treasury/i;
const removedCreationAbiWords = /\b(?:formation|snapshot|signature|price|market.?cap|weight|expiry|nonce|predict)\b/i;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function findForge() {
  if (process.env.FORGE_BIN) return process.env.FORGE_BIN;
  const command = process.platform === "win32" ? "where.exe" : "which";
  const discovered = spawnSync(command, ["forge"], { encoding: "utf8" });
  if (discovered.status === 0) return discovered.stdout.trim().split(/\r?\n/u)[0];
  const candidates = [join(homedir(), ".foundry", "bin", process.platform === "win32" ? "forge.exe" : "forge")];
  const forgeHome = process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Foundry");
  if (forgeHome && existsSync(forgeHome)) {
    for (const entry of readdirSync(forgeHome).sort().reverse()) candidates.push(join(forgeHome, entry, "forge.exe"));
  }
  const forge = candidates.find(existsSync);
  return forge;
}

const forge = findForge();
const solhint = join(root, "node_modules", "solhint", "solhint.js");
function runForge(args) {
  if (!forge) return;
  return execFileSync(forge, args, { cwd: contracts, stdio: "inherit" });
}
function byteLength(hex) {
  assert(typeof hex === "string", "artifact bytecode is missing");
  const value = hex.startsWith("0x") ? hex.slice(2) : hex;
  assert(value.length % 2 === 0, "artifact bytecode has an odd number of hex digits");
  return value.length / 2;
}
function artifact(name) {
  const path = join(contracts, "out", `${name}.sol`, `${name}.json`);
  assert(existsSync(path), `missing fresh artifact ${relative(root, path)}`);
  return JSON.parse(readFileSync(path, "utf8"));
}
function functions(compiled) { return compiled.abi.filter((item) => item.type === "function"); }
function functionNames(compiled) { return new Set(functions(compiled).map((item) => item.name)); }
function constructor(compiled) { return compiled.abi.find((item) => item.type === "constructor"); }

assert(existsSync(solhint), "solhint is not installed; run corepack pnpm install");
execFileSync(process.execPath, [solhint, "contracts/src/**/*.sol", "--max-warnings", "0"], { cwd: root, stdio: "inherit" });

// Regenerate artifacts before inspecting them so removed production modules cannot linger.
execFileSync(process.execPath, [join(root, "scripts", "compile-contracts.mjs")], { cwd: root, stdio: "inherit" });
if (forge) {
  runForge(["build", "--force", "-q"]);
  runForge(["lint", "src", "--deny", "warnings"]);
} else {
  console.warn("Foundry is unavailable; continuing with solc artifacts and solhint checks.");
}

function soliditySourceNames(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return soliditySourceNames(path);
    return entry.isFile() && entry.name.endsWith(".sol") ? [entry.name] : [];
  });
}
const sourceNames = soliditySourceNames(join(contracts, "src"));
assert(!sourceNames.some((name) => forbiddenArtifactName.test(name)), "stale production source remains");
const artifactNames = readdirSync(join(contracts, "out"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);
assert(!artifactNames.some((name) => forbiddenArtifactName.test(name)), "stale production artifact remains");

const compiled = Object.fromEntries(production.map((name) => [name, artifact(name)]));
for (const [name, value] of Object.entries(compiled)) {
  assert(byteLength(value.deployedBytecode.object) <= runtimeLimit, `${name} runtime exceeds ${runtimeLimit} bytes`);
  assert(byteLength(value.bytecode.object) <= initcodeLimit, `${name} initcode exceeds ${initcodeLimit} bytes`);
}

const vaultStorage = artifact("ManagedOTFVaultStorage").storageLayout;
const vaultLayout = compiled.ManagedOTFVault.storageLayout;
assert(vaultStorage && vaultLayout, "fresh vault storage layouts are missing");
const normalizeStorage = (layout) => layout.storage.map((entry) => ({
  label: entry.label,
  slot: entry.slot,
  offset: entry.offset,
  type: layout.types[entry.type]?.label,
  bytes: layout.types[entry.type]?.numberOfBytes,
}));
assert(JSON.stringify(normalizeStorage(vaultStorage)) === JSON.stringify(normalizeStorage(vaultLayout)), "vault storage differs from canonical fresh layout");
const expectedStorage = [
  "_shutdown", "_entered", "_factory", "_creator", "_expenseBeneficiary",
  "_buybackCollector", "_entryExitRouter", "_otfToken", "_fundThesis", "_annualCreatorExpenseRatioBps",
  "_mintFeeBps", "_redeemFeeBps", "_shutdownAt",
  "_assets", "_bootstrapBasketUnitsPerOTF", "_accountedBalance", "_feeEpochTimestamp",
  "_lastFeeCheckpointTimestamp", "_feeEpochSupply", "_feeEpochAccruedShares", "_feeShareRemainderWad",
  "_expenseCreatorSplitRemainderBps",
];
assert(JSON.stringify(vaultLayout.storage.map((entry) => entry.label)) === JSON.stringify(expectedStorage), "unexpected or legacy vault storage field");

const vaultStorageSource = readFileSync(join(contracts, "src", "ManagedOTFVaultStorage.sol"), "utf8");
const vaultSource = readFileSync(join(contracts, "src", "ManagedOTFVault.sol"), "utf8");
const otfTokenSource = readFileSync(join(contracts, "src", "OTFToken.sol"), "utf8");
const otfMetadataSource = readFileSync(join(contracts, "src", "libraries", "OTFMetadata.sol"), "utf8");
const squareIconSource = readFileSync(join(root, "packages", "brand", "assets", "otf-icon.svg"), "utf8");
assert(!existsSync(join(contracts, "src", "ERC20Base.sol")), "hand-written ERC20Base remains in production sources");
assert(/ManagedOTFVaultStorage is ERC20Upgradeable/u.test(vaultStorageSource), "vault shares do not use OpenZeppelin ERC20Upgradeable");
assert(
  /_disableInitializers\(\)/u.test(vaultSource)
    && /external\s+initializer\s+nonReentrant/u.test(vaultSource)
    && /__ERC20_init\(params\.name, params\.symbol\)/u.test(vaultSource),
  "vault ERC20 initialization is not clone-safe and implementation-locked",
);
const vaultInitializers = functions(compiled.ManagedOTFVault).filter((item) => item.name === "initialize");
assert(vaultInitializers.length === 1, "vault exposes more than one initializer");
assert(
  vaultInitializers[0].inputs.map((input) => input.type).join(",") === "tuple,address",
  "vault initializer does not use the canonical creation tuple and creator",
);
assert(!/VaultInitParams/u.test(vaultSource), "vault retains the legacy initialization tuple");
assert(
  /import\s*\{\s*ERC20Burnable\s*\}\s*from\s*[\r\n\s]*"@openzeppelin\/contracts\/token\/ERC20\/extensions\/ERC20Burnable\.sol"/u.test(otfTokenSource)
    && /OTFToken is ERC20Burnable/u.test(otfTokenSource),
  "OTFToken does not inherit OpenZeppelin ERC20Burnable directly",
);
assert(!/function\s+burn(?:From)?\s*\(/u.test(otfTokenSource), "OTFToken hand-writes a burn function");
for (const fragment of [
  'viewBox="0 0 256 256"', 'fill="#090909"', 'stroke="#ccff00"',
  'stroke-width="16"', 'font-weight="700"',
]) {
  assert(otfMetadataSource.includes(fragment), `onchain OTF metadata is missing ${fragment}`);
  assert(squareIconSource.includes(fragment), `square brand SVG is missing ${fragment}`);
}
assert(/Base64\.encode\(bytes\(SQUARE_ICON_SVG\)\)/u.test(otfMetadataSource), "onchain OTF image is not SVG base64");
assert(/OTFMetadata\.protocolTokenURI\(\)/u.test(otfTokenSource), "OTFToken does not use canonical onchain metadata");

const expectedConstructors = {
  ManagedOTFVault: [],
  OTFToken: ["initialHolder"],
  OTFFactory: ["vaultImplementation_", "buybackCollector_", "otfToken_"],
  OTFEntryExitRouter: ["factory_", "initialAdapterManager", "weth_"],
  UniswapV3Adapter: ["entryExitRouter_", "uniswapV3Factory_", "uniswapV3Router_"],
  UniswapV4Adapter: ["entryExitRouter_", "uniswapV4PoolManager_", "uniswapV4StateView_", "uniswapUniversalRouter_", "permit2_"],
  OTFLaunchManager: ["otf_", "weth_", "poolManager_", "stateView_", "positionManager_", "permit2_"],
  OTFLaunchManagerDeployer: [],
  OTFLaunchRouter: ["launchManager_"],
  TeamMarketCapVesting: ["launchManager", "ethUsdOracle_", "maxOracleAge_", "beneficiary_"],
  BuybackCollector: ["launchManager_", "universalRouter_", "permit2_"],
  MerkleRewardsDistributor: ["otf_", "rootPublisher"],
  FakeETHUSDOracle: [],
};
for (const [name, expected] of Object.entries(expectedConstructors)) {
  const actual = constructor(compiled[name]);
  if (expected.length === 0 && !actual) continue;
  assert(actual && actual.inputs.length === expected.length, `${name} constructor arity changed`);
  assert(actual.inputs.every((input, index) => input.name === expected[index]), `${name} constructor fields changed`);
}

const teamVestingNames = functionNames(compiled.TeamMarketCapVesting);
for (const name of ["beneficiary", "pendingBeneficiary", "initiateBeneficiaryTransfer", "cancelBeneficiaryTransfer", "acceptBeneficiaryTransfer", "claim"]) {
  assert(teamVestingNames.has(name), `team vesting beneficiary-transfer surface ${name} is absent`);
}
const teamVestingMutating = functions(compiled.TeamMarketCapVesting)
  .filter((item) => !["view", "pure"].includes(item.stateMutability))
  .map((item) => item.name)
  .sort();
assert(JSON.stringify(teamVestingMutating) === JSON.stringify([
  "acceptBeneficiaryTransfer", "cancelBeneficiaryTransfer", "checkpoint", "claim", "initiateBeneficiaryTransfer",
].sort()), "team vesting exposes an unexpected mutating entrypoint");
const teamVestingEvents = new Set(
  compiled.TeamMarketCapVesting.abi.filter((item) => item.type === "event").map((item) => item.name),
);
for (const name of ["BeneficiaryTransferInitiated", "BeneficiaryTransferCancelled", "BeneficiaryTransferAccepted"]) {
  assert(teamVestingEvents.has(name), `team vesting event ${name} is absent`);
}
const teamVestingSource = readFileSync(join(contracts, "src", "TeamMarketCapVesting.sol"), "utf8");
assert(/address public beneficiary;/u.test(teamVestingSource), "team beneficiary is not mutable storage");
assert(/address public pendingBeneficiary;/u.test(teamVestingSource), "pending team beneficiary storage is absent");
assert(!/immutable\s+beneficiary/u.test(teamVestingSource), "team beneficiary remains immutable");

const factoryNames = functionNames(compiled.OTFFactory);
for (const name of ["configureEntryExitRouter", "vaultCount", "vaultAt", "createVault", "buybackCollector", "otfToken", "otfTokenURI", "isVault"]) {
  assert(factoryNames.has(name), `factory function ${name} is absent`);
}
const createVault = functions(compiled.OTFFactory).find((item) => item.name === "createVault");
assert(createVault.inputs.length === 1 && createVault.inputs[0].type === "tuple", "createVault must accept one creation tuple");
const creationComponents = createVault.inputs[0].components.map((input) => `${input.name}:${input.type}`);
assert(creationComponents.join("|") === "name:string|symbol:string|fundThesis:string|expenseBeneficiary:address|annualCreatorExpenseRatioBps:uint16|mintFeeBps:uint16|redeemFeeBps:uint16|constituents:address[]|bootstrapBasketUnitsPerOTF:uint256[]", "createVault tuple is not the canonical fee/bootstrap form");
assert(!JSON.stringify(compiled.OTFFactory.abi).match(removedCreationAbiWords), "factory ABI contains a removed creation input or API");
const factoryCtor = constructor(compiled.OTFFactory);
assert(factoryCtor.inputs.map((input) => input.type).join(",") === "address,address,address", "factory immutable dependency constructor changed");
const factorySource = readFileSync(join(contracts, "src", "OTFFactory.sol"), "utf8");
assert(/Clones\.clone\(vaultImplementation\)/u.test(factorySource), "factory creation does not use nondeterministic clones");
assert(!/(?:cloneDeterministic|predictDeterministicAddress|salt)/iu.test(factorySource), "factory retains deterministic clone machinery");
assert(!/registerVault/u.test(factorySource), "factory retains collector vault registration");
assert(/OTFMetadata\.shareTokenURI\(\)/u.test(factorySource), "vault shares do not use canonical onchain metadata");
assert(/IOTFFactoryTokenPolicy\(_factory\)\.otfTokenURI\(\)/u.test(vaultSource), "vault tokenURI does not resolve factory metadata");
const routerConfigurationSource = factorySource.match(
  /function\s+configureEntryExitRouter[\s\S]*?\n\s*function\s+vaultCount/u,
)?.[0] ?? "";
assert(
  (factorySource.match(/abi\.encodeCall\(ICanonicalBuybackCollector\.factory/gu) ?? []).length === 1
    && /buybackCollector\.staticcall/u.test(routerConfigurationSource)
    && /!success\s*\|\|\s*result\.length\s*!=\s*32/u.test(routerConfigurationSource)
    && /observedCollectorFactory\s*!=\s*address\(this\)/u.test(routerConfigurationSource)
    && /revert InvalidDependency\(buybackCollector\)/u.test(routerConfigurationSource),
  "factory does not validate its reciprocal collector binding during one-time router configuration",
);

const vaultErrorNames = new Set(compiled.ManagedOTFVault.abi.filter((item) => item.type === "error").map((item) => item.name));
assert(!vaultErrorNames.has("ResidualSupplyTooSmall"), "vault retains the removed residual supply revert");
for (const name of ["fundThesis", "bootstrapBasketUnits", "bootstrapBasketUnitsPerOTF", "redeemInKind"]) {
  assert(functionNames(compiled.ManagedOTFVault).has(name), `vault bootstrap surface ${name} is absent`);
}
const fundThesis = functions(compiled.ManagedOTFVault).find((item) => item.name === "fundThesis");
assert(fundThesis.stateMutability === "view" && fundThesis.inputs.length === 0 && fundThesis.outputs[0]?.type === "string", "fundThesis is not a direct string view");
assert((vaultSource.match(/_fundThesis\s*=/gu) ?? []).length === 1, "fund thesis must have exactly one initialization write");
const redeemInKind = functions(compiled.ManagedOTFVault).find((item) => item.name === "redeemInKind");
assert(redeemInKind.inputs.map((input) => input.type).join(",") === "uint256,address,uint256[],uint256", "redeemInKind signature changed");
const routerRedeem = functions(compiled.ManagedOTFVault).find((item) => item.name === "routerRedeem");
assert(routerRedeem.inputs.map((input) => input.type).join(",") === "uint256,address,address,uint256[],uint256", "routerRedeem is not skip-aware");
const previewRedeem = functions(compiled.ManagedOTFVault).find((item) => item.name === "previewRedeem");
assert(previewRedeem.inputs.map((input) => input.type).join(",") === "uint256,address,uint256", "previewRedeem must include the share owner and skip mask");
const previewRedeemFee = functions(compiled.ManagedOTFVault).find((item) => item.name === "previewRedeemFee");
assert(previewRedeemFee.inputs.map((input) => input.type).join(",") === "uint256,address", "previewRedeemFee must include the share owner");
assert(!functionNames(compiled.ManagedOTFVault).has("emergencyRedeem"), "vault retains emergencyRedeem");
assert(!vaultErrorNames.has("VaultNotShutdown"), "vault retains the emergency-redemption-only error");

const routerFunctions = functions(compiled.OTFEntryExitRouter);
const routerMutating = routerFunctions.filter((item) => !["view", "pure"].includes(item.stateMutability)).map((item) => item.name).sort();
assert(JSON.stringify(routerMutating) === JSON.stringify(["acceptOwnership", "mintFromNative", "mintFromToken", "redeemToNative", "redeemToToken", "renounceOwnership", "setAdapterApproved", "swapBasketToBasket", "swapFeeSharesToWeth", "transferOwnership"].sort()), "router exposes an unexpected mutating entrypoint");
for (const name of ["mintFromNative", "mintFromToken", "redeemToNative", "redeemToToken", "swapBasketToBasket", "swapFeeSharesToWeth", "factory", "weth", "isAdapterApproved", "setAdapterApproved", "owner", "pendingOwner"]) assert(functionNames(compiled.OTFEntryExitRouter).has(name), `router surface ${name} is absent`);
assert(!functionNames(compiled.OTFEntryExitRouter).has("swapDirect"), "router retains swapDirect");
const mintFromToken = routerFunctions.find((item) => item.name === "mintFromToken");
const swapLeg = mintFromToken.inputs[1];
assert(swapLeg.type === "tuple[]", "router legs are not a generic tuple array");
assert(swapLeg.components.map((input) => `${input.name}:${input.type}`).join("|") === "adapter:address|tokenIn:address|tokenOut:address|amountIn:uint256|minAmountOut:uint256|data:bytes", "router SwapLeg is not the bounded adapter interface");
const redeemToToken = routerFunctions.find((item) => item.name === "redeemToToken");
assert(redeemToToken.inputs[0].components.map((input) => `${input.name}:${input.type}`).join("|") === "vault:address|outputToken:address|shares:uint256|minAmountOut:uint256|skipMask:uint256|deadline:uint256", "router redemption request is not skip-aware");
const swapBasketToBasket = routerFunctions.find((item) => item.name === "swapBasketToBasket");
assert(swapBasketToBasket.inputs[0].components.map((input) => `${input.name}:${input.type}`).join("|") === "sourceVault:address|targetVault:address|sharesIn:uint256|minSharesOut:uint256|sourceSkipMask:uint256|deadline:uint256", "basket conversion request is not source-skip-aware");

const adapterNames = functionNames(compiled.UniswapV3Adapter);
for (const name of ["entryExitRouter", "uniswapV3Factory", "uniswapV3Router", "executeSwap", "MAX_HOPS"]) assert(adapterNames.has(name), `UniswapV3Adapter surface ${name} is absent`);
assert(functions(compiled.UniswapV3Adapter).filter((item) => !["view", "pure"].includes(item.stateMutability)).map((item) => item.name).join(",") === "executeSwap", "UniswapV3Adapter exposes an unexpected mutating entrypoint");
const v4AdapterNames = functionNames(compiled.UniswapV4Adapter);
for (const name of ["entryExitRouter", "uniswapV4PoolManager", "uniswapV4StateView", "uniswapUniversalRouter", "permit2", "executeSwap", "MAX_HOPS", "MAX_HOOK_DATA_LENGTH"]) assert(v4AdapterNames.has(name), `UniswapV4Adapter surface ${name} is absent`);
assert(functions(compiled.UniswapV4Adapter).filter((item) => !["view", "pure"].includes(item.stateMutability)).map((item) => item.name).join(",") === "executeSwap", "UniswapV4Adapter exposes an unexpected mutating entrypoint");

const sourceConstants = readFileSync(join(contracts, "src", "libraries", "ProtocolConstants.sol"), "utf8");
assert(/MAX_ANNUAL_CREATOR_EXPENSE_RATIO_BPS\s*=\s*1_000/u.test(sourceConstants), "maximum creator fee is not 1000 bps");
assert(/MAX_MINT_FEE_BPS\s*=\s*200/u.test(sourceConstants), "maximum mint fee is not 200 bps");
assert(/MAX_REDEEM_FEE_BPS\s*=\s*100/u.test(sourceConstants), "maximum redeem fee is not 100 bps");
assert(/OTF_FEE_BENEFIT_CAP\s*=\s*10_000_000 ether/u.test(sourceConstants), "OTF fee benefit is not capped at 10 million OTF");
assert(/MIN_CONSTITUENTS\s*=\s*2/u.test(sourceConstants), "minimum constituents is not 2");
assert(/MAX_CONSTITUENTS\s*=\s*20/u.test(sourceConstants), "maximum constituents is not 20");
assert(/MAX_SWAP_HOPS\s*=\s*3/u.test(sourceConstants), "maximum swap hops is not 3");
assert(/MAX_FUND_THESIS_BYTES\s*=\s*2_048/u.test(sourceConstants), "maximum fund thesis is not 2048 bytes");
assert(/MINIMUM_SHARE_SUPPLY\s*=\s*1e16/u.test(sourceConstants), "bootstrap and shutdown threshold is not 0.01 OTF");
for (const sharedV4Constant of ["UNISWAP_V4_SWAP_COMMAND", "UNISWAP_V4_SWAP_EXACT_IN_ACTION", "UNISWAP_V4_SETTLE_ALL_ACTION", "UNISWAP_V4_TAKE_ALL_ACTION"]) {
  assert(sourceConstants.includes(sharedV4Constant), `shared V4 constant ${sharedV4Constant} is absent`);
}
const routerSource = readFileSync(join(contracts, "src", "OTFEntryExitRouter.sol"), "utf8");
assert(/msg\.sender\s*!=\s*IOTFSettlementFactory\(factory\)\.buybackCollector\(\)/u.test(routerSource), "fee-share sale is not restricted to the factory collector");
assert(/MIN_CONSTITUENTS\s*=\s*ProtocolConstants\.MIN_CONSTITUENTS/u.test(routerSource), "router minimum constituents is not shared");
assert(/MAX_CONSTITUENTS\s*=\s*ProtocolConstants\.MAX_CONSTITUENTS/u.test(routerSource), "router maximum constituents is not shared");
const adapterSource = readFileSync(join(contracts, "src", "UniswapV3Adapter.sol"), "utf8");
const v4AdapterSource = readFileSync(join(contracts, "src", "UniswapV4Adapter.sol"), "utf8");
assert(/MAX_HOPS\s*=\s*ProtocolConstants\.MAX_SWAP_HOPS/u.test(adapterSource), "V3 adapter maximum hops is not shared");
assert(/MAX_HOPS\s*=\s*ProtocolConstants\.MAX_SWAP_HOPS/u.test(v4AdapterSource), "V4 adapter maximum hops is not shared");
assert(!/delegatecall/u.test(routerSource + adapterSource + v4AdapterSource), "router or adapter contains delegatecall execution");
assert(!/function\s+execute\s*\(\s*address\s+target/iu.test(routerSource + adapterSource + v4AdapterSource), "router or adapter exposes an arbitrary target");
assert(/recipient:\s*entryExitRouter/u.test(adapterSource), "V3 adapter recipient is not fixed to the entry router");
assert(/abi\.decode\(data,\s*\(PathKey\[\]\)\)/u.test(v4AdapterSource), "V4 adapter data is not a canonical typed pool-key path");
assert(/IV4Router\.ExactInputParams/u.test(v4AdapterSource), "V4 adapter does not use the canonical router tuple");
assert(/SWAP_EXACT_IN_ACTION,\s*SETTLE_ALL_ACTION,\s*TAKE_ALL_ACTION/u.test(v4AdapterSource), "V4 adapter does not construct the fixed swap/settle/take action stream");

const tokenNames = functionNames(compiled.OTFToken);
assert(tokenNames.has("MAX_SUPPLY") && tokenNames.has("totalSupply") && tokenNames.has("balanceOf") && tokenNames.has("tokenURI"), "fixed OTF supply surface is incomplete");
assert(tokenNames.has("burn") && tokenNames.has("burnFrom"), "OTF token is missing inherited burn functions");
assert(![...tokenNames].some((name) => /^(mint|set.*Supply|increaseSupply|decreaseSupply)$/iu.test(name)), "OTF token exposes a post-construction supply function");
assert(!functions(compiled.OTFToken).some((item) => item.name === "burn" && item.inputs.length !== 1), "OTF token exposes a privileged burn overload");
assert(!functions(compiled.OTFToken).some((item) => item.name === "burnFrom" && item.inputs.map((input) => input.type).join(",") !== "address,uint256"), "OTF token exposes a custom burnFrom overload");
assert(compiled.OTFToken.abi.filter((item) => item.type === "constructor")[0].inputs[0].type === "address", "OTF token holder constructor changed");

for (const removed of ["FeeCollector", "protocolFeeShareBps", "claimTreasury", "treasury"]) {
  assert(!JSON.stringify(Object.values(compiled).map((value) => value.abi)).includes(`\"${removed}\"`), `removed treasury surface ${removed} remains`);
}
const buybackSource = readFileSync(join(contracts, "src", "BuybackCollector.sol"), "utf8");
assert(!/function\s+(?:withdraw|rescue|sweep)/iu.test(buybackSource), "buyback collector exposes an asset withdrawal path");
assert(!/delegatecall|\.call\s*\{/u.test(buybackSource), "buyback collector exposes arbitrary execution");
assert(/IOTFBurnable\(otf\)\.burn\(otfBurned\)/u.test(buybackSource), "buyback collector does not burn purchased OTF");
const buybackNames = functionNames(compiled.BuybackCollector);
for (const name of ["configureFactory", "recordFeeShares", "settleFeesViaRedemption", "settleFeesViaShareSale", "feeAccounts"]) {
  assert(buybackNames.has(name), `buyback collector function ${name} is absent`);
}
for (const removed of ["configureEntryExitRouter", "registerVault", "entryExitRouter"]) {
  assert(!buybackNames.has(removed), `buyback collector retains redundant ${removed} surface`);
}
const buybackEvents = new Set(
  compiled.BuybackCollector.abi.filter((item) => item.type === "event").map((item) => item.name),
);
assert(!buybackEvents.has("VaultRegistered"), "buyback collector retains the removed VaultRegistered event");
const feeAccounts = functions(compiled.BuybackCollector).find((item) => item.name === "feeAccounts");
assert(
  feeAccounts.outputs.map((output) => `${output.name}:${output.type}`).join(",")
    === "creatorFeeShares:uint256,buybackFeeShares:uint256",
  "collector feeAccounts output is not exactly creator and buyback fee shares",
);
const settleFeesViaRedemption = functions(compiled.BuybackCollector).find((item) => item.name === "settleFeesViaRedemption");
assert(settleFeesViaRedemption.inputs.map((input) => input.type).join(",") === "address,uint256[],uint256,tuple[],uint256,uint256,uint256", "collector redemption settlement is not skip-aware");
for (const removed of ["executeBuyback", "settleFees", "owner", "pendingOwner", "transferOwnership", "routeExecutor"]) {
  assert(!buybackNames.has(removed), `buyback collector retains legacy route-executor surface ${removed}`);
}
assert(/IOTFSettlementVault\(request\.vault\)\.checkpointFees\(\)/u.test(routerSource), "router does not checkpoint annual fees before settlement");
assert(/IBuybackVault\(vault\)\.checkpointFees\(\)/u.test(buybackSource), "fee settlement does not checkpoint annual fees");
assert(/account\.creatorFeeShares\s*=\s*0/u.test(buybackSource) && /account\.buybackFeeShares\s*=\s*0/u.test(buybackSource), "fee settlement does not atomically consume both pending share accounts");
assert(/Math\.mulDiv\(wethOut, pending\.creatorFeeShares, pending\.totalFeeShares\)/u.test(buybackSource), "settlement does not split actual WETH by recorded fee shares");
const distributorSource = readFileSync(join(contracts, "src", "MerkleRewardsDistributor.sol"), "utf8");
assert(!/function\s+(?:withdraw|rescue|sweep)/iu.test(distributorSource), "rewards distributor exposes a principal withdrawal path");
assert(/block\.chainid,\s*address\(this\),\s*account,\s*cumulativeEntitlement/u.test(distributorSource), "Merkle leaf does not bind chain, distributor, account, and cumulative entitlement");
const launchSource = readFileSync(join(contracts, "src", "OTFLaunchManager.sol"), "utf8");
assert(!/function\s+(?:withdraw|removeLiquidity|reprice|rebalance|migrate)/iu.test(launchSource), "launch manager exposes permanent-liquidity control");
assert(/LP_FEE\s*=\s*0/u.test(launchSource), "OTF V4 pool fee is not statically zero");
assert(/TICK_SPACING\s*=\s*1/u.test(launchSource), "OTF V4 pool tick spacing is not statically one");
assert(!/\bMAX_SUPPLY\s*=/u.test(launchSource), "launch manager duplicates the token's original supply");
assert(!/LAUNCH_REFERENCE_FDV_WEI|TARGET_REFERENCE_FDV_WEI/u.test(launchSource), "launch manager retains display-only FDV constants");
assert(/MAX_BOOTSTRAP_BUDGET\s*=\s*150_000_000 ether/u.test(launchSource), "bootstrap safety cap changed");
assert(/PERMANENT_OTF_CAP\s*=\s*50_000_000 ether/u.test(launchSource), "permanent OTF cap changed");
assert(/REQUIRED_OTF_BALANCE\s*=\s*200_000_000 ether/u.test(launchSource), "launch funding requirement changed");
assert(/BOOTSTRAP_LIQUIDITY\s*=\s*27_556_748_080_852_150_400_017/u.test(launchSource), "bootstrap liquidity changed");
assert(/PERMANENT_LIQUIDITY\s*=\s*18_371_007_233_046_122_951_295/u.test(launchSource), "permanent liquidity changed");
for (const constant of [
  "-180_161", "-158_188", "9_703_428_570_912_459_262_669_889",
  "180_161", "158_188",
  "646_895_238_060_830_617_511_325_894_307_352",
]) {
  assert(launchSource.includes(constant), `launch manager is missing derived curve constant ${constant}`);
}
assert(/BEFORE_INITIALIZE_FLAG\s*=\s*1\s*<<\s*13/u.test(launchSource), "launch manager is missing the beforeInitialize hook flag");
assert(/REQUIRED_HOOK_FLAGS\s*=\s*BEFORE_INITIALIZE_FLAG\s*\|\s*BEFORE_ADD_LIQUIDITY_FLAG\s*\|\s*AFTER_SWAP_FLAG/u.test(launchSource), "launch manager hook permissions are not exactly beforeInitialize + beforeAddLiquidity + afterSwap");
assert(/BEFORE_ADD_LIQUIDITY_FLAG\s*=\s*1\s*<<\s*11/u.test(launchSource), "launch manager is missing the beforeAddLiquidity hook flag");
assert(functionNames(compiled.OTFLaunchManager).has("beforeAddLiquidity"), "launch manager ABI is missing beforeAddLiquidity");
const addLiquidityHook = launchSource.slice(launchSource.indexOf("function beforeAddLiquidity("), launchSource.indexOf("function initializeLaunch("));
for (const check of [
  "msg.sender != poolManager", "_poolId(key) != poolId", "sender != positionManager",
  "_internalMint == InternalMint.Bootstrap && phase == Phase.NotInitialized",
  "_internalMint == InternalMint.Permanent && phase == Phase.GraduationReady",
  "params.tickLower !=", "params.tickUpper !=",
  "params.liquidityDelta != int256(uint256(BOOTSTRAP_LIQUIDITY))",
  "params.liquidityDelta != int256(uint256(PERMANENT_LIQUIDITY))",
  "phase == Phase.Graduated",
]) assert(addLiquidityHook.includes(check), `liquidity authorization is missing ${check}`);
assert(/_internalMint = InternalMint\.Bootstrap;\s*bootstrapPositionTokenId = _mintPosition\([\s\S]*?\);\s*delete _internalMint;/u.test(launchSource), "bootstrap mint authorization is not scoped to its synchronous call");
assert(/_internalMint = InternalMint\.Permanent;\s*permanentPositionTokenId = _mintPosition\([\s\S]*?\);\s*delete _internalMint;/u.test(launchSource), "permanent mint authorization is not scoped to its synchronous call");
assert(/&\s*ALL_HOOK_MASK\s*==\s*REQUIRED_HOOK_FLAGS/u.test(launchSource), "launch manager does not enforce the exact required hook flags");
assert(/function\s+beforeInitialize\s*\(\s*address\s+initializer,\s*UniswapV4PoolKey\s+calldata,\s*uint160\s*\)/u.test(launchSource), "launch manager is missing the typed beforeInitialize callback");
assert(/msg\.sender\s*!=\s*poolManager/u.test(launchSource), "launch callbacks do not authenticate the immutable PoolManager");
assert(/initializer\s*!=\s*address\(this\)/u.test(launchSource), "launch manager does not reject non-self pool initializers");
assert(!/function\s+beforeSwap/u.test(launchSource), "launch manager adds a permanent beforeSwap callback");
assert(/TickMath\.getSqrtPriceAtTick/u.test(launchSource), "launch execution does not derive tick boundaries with pinned TickMath");
assert(/SqrtPriceMath\.getAmount[01]Delta/u.test(launchSource), "launch execution does not use pinned V4 amount-delta math");
assert(/sqrtPriceX96\s*==\s*finalSqrtPriceX96/u.test(launchSource), "graduation is not keyed to exact sqrt price equality");

const launchRouterSource = readFileSync(join(contracts, "src", "OTFLaunchRouter.sol"), "utf8");
const launchRouterNames = functionNames(compiled.OTFLaunchRouter);
for (const name of ["buyOtfWithWeth", "buyOtfWithEth", "sellOtfForWeth", "sellOtfForEth", "unlockCallback"]) {
  assert(launchRouterNames.has(name), `launch router function ${name} is absent`);
}
assert(!/delegatecall/u.test(launchRouterSource), "launch router contains delegatecall execution");
assert(/finalSqrtPriceX96\(\)/u.test(launchRouterSource), "launch router does not use the exact graduation boundary");
assert(/bootstrapSqrtPriceBounds\(\)/u.test(launchRouterSource), "launch router does not use the initialization-side boundary");
assert(/phase\(\)\s*==\s*GRADUATION_READY/u.test(launchRouterSource), "launch router does not finalize after unlock");

const deploySource = readFileSync(join(root, "scripts", "deploy-robinhood-testnet.mjs"), "utf8");
assert(/uniswapV3SwapRouter02/u.test(deploySource), "deployment does not require an explicit SwapRouter02 address");
assert(/deploy\("UniswapV3Adapter"/u.test(deploySource), "deployment does not deploy UniswapV3Adapter");
assert(/deploy\("UniswapV4Adapter"/u.test(deploySource), "deployment does not deploy UniswapV4Adapter");
assert(/deploy\("OTFLaunchRouter"/u.test(deploySource), "deployment does not deploy OTFLaunchRouter");
assert((deploySource.match(/"setAdapterApproved"/gu) ?? []).length === 3 && deploySource.includes("revokePreviousAdapters"), "deployment must approve both replacements and revoke both previous adapters");
for (const name of ["OTFToken", "TeamMarketCapVesting", "BuybackCollector", "MerkleRewardsDistributor", "FakeETHUSDOracle"]) {
  assert(deploySource.includes(`deploy(\"${name}\"`), `deployment does not deploy ${name}`);
}
assert(/functionName:\s*"beneficiary"/u.test(deploySource) && /functionName:\s*"pendingBeneficiary"/u.test(deploySource), "deployment does not verify initial team beneficiary state");
const testnetConfig = JSON.parse(readFileSync(join(root, "app", "src", "config", "robinhood-testnet.json"), "utf8"));
const testnetRoutingPin = JSON.parse(readFileSync(join(root, "scripts", "fixtures", "robinhood-testnet-routing.json"), "utf8"));
assertTestnetRoutingConfiguration(testnetConfig, testnetRoutingPin);
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
assert(packageJson.devDependencies["@uniswap/v4-periphery"] === "github:Uniswap/v4-periphery#3231810e39b8c4d569b9d66907fa4ef8cd2cec22", "V4 periphery is not pinned to Universal Router 2.1.1");
assert(packageJson.devDependencies["@uniswap/v4-core"] === "github:Uniswap/v4-core#59d3ecf53afa9264a16bba0e38f4c5d2231f80bc", "V4 core differs from the pinned periphery dependency");
assert(packageJson.devDependencies["@uniswap/permit2"] === "github:Uniswap/permit2#cc56ad0f3439c502c246fc5cfcc3db92bb8b7219", "Permit2 differs from the pinned periphery dependency");
const v4RouterSource = readFileSync(
  join(root, "node_modules", "@uniswap", "v4-periphery", "src", "interfaces", "IV4Router.sol"),
  "utf8",
);
const exactInputFields = v4RouterSource.match(/struct ExactInputParams\s*\{([^}]+)\}/u)?.[1]
  .trim().split(/\s*;\s*/u).filter(Boolean);
assert(JSON.stringify(exactInputFields) === JSON.stringify(["Currency currencyIn", "PathKey[] path", "uint256[] minHopPriceX36", "uint128 amountIn", "uint128 amountOutMinimum"]), "canonical V4 exact-input tuple differs from Universal Router 2.1.1");
assert(/verifyTestnetRoutingRuntime\(publicClient, previous, routingPin\)/u.test(deploySource), "deployment does not enforce the validated testnet runtime binding");
assert(testnetConfig.trustedRoles.teamBeneficiary === "0xc340D7085E321B82CF550904310EE44bae9e4CD2", "configured testnet team beneficiary changed");
assert(!("architecture" in testnetConfig), "testnet configuration must not use an architecture version gate");
assert(testnetConfig.status === "not-deployed" || testnetConfig.status === "deployed", "testnet configuration has an invalid deployment status");
if (testnetConfig.status === "not-deployed") {
  assert(Object.keys(testnetConfig.contracts).length === 0, "undeployed testnet configuration contains protocol addresses");
} else {
  assert(testnetConfig.launch.exactInitializationReferenceFdvWei === "15000000000000000000", "deployed testnet launch reference FDV mismatch");
  assert(testnetConfig.launch.nominalTargetReferenceFdvWei === "135000000000000000000", "deployed testnet target reference FDV mismatch");
}
if (testnetConfig.status === "not-deployed") {
  assert(testnetConfig.launch.directDerivedBootstrapOtf === "149997417396300389512897535", "testnet direct bootstrap vector mismatch");
  assert(testnetConfig.launch.inverseDerivedBootstrapOtf === "149997417396300389512897549", "testnet inverse bootstrap vector mismatch");
  assert(testnetConfig.launch.directDerivedPermanentOtf === "49999999999999999999997973", "testnet direct permanent vector mismatch");
  assert(testnetConfig.launch.inverseDerivedPermanentOtf === "49999999999999999999997974", "testnet inverse permanent vector mismatch");
  assert(testnetConfig.launch.derivedBootstrapWethPrincipalWei === "6749878135132658333", "testnet bootstrap WETH principal mismatch");
  assert(testnetConfig.launch.derivedPermanentWeth === "6749878135132658333", "testnet permanent WETH amount mismatch");
} else {
  const expectedBootstrapOtf = testnetConfig.launch.otfIsCurrency0
    ? "149997417396300389512897535"
    : "149997417396300389512897549";
  const expectedPermanentOtf = testnetConfig.launch.otfIsCurrency0
    ? "49999999999999999999997973"
    : "49999999999999999999997974";
  assert(testnetConfig.launch.derivedBootstrapOtf === expectedBootstrapOtf, "deployed bootstrap vector mismatch");
  assert(testnetConfig.launch.derivedBootstrapWethPrincipalWei === "6749878135132658333", "deployed bootstrap WETH principal mismatch");
  assert(testnetConfig.launch.derivedPermanentOtf === expectedPermanentOtf, "deployed permanent OTF amount mismatch");
  assert(testnetConfig.launch.derivedPermanentWeth === "6749878135132658333", "deployed permanent WETH amount mismatch");
}
const mainnetConfig = JSON.parse(readFileSync(join(root, "app", "src", "config", "robinhood-mainnet.json"), "utf8"));
assert(!("architecture" in mainnetConfig), "mainnet configuration must not use an architecture version gate");
assert(/type\(OTFLaunchManager\)|bytecode\("OTFLaunchManager"\)/u.test(deploySource), "deployment does not construct OTFLaunchManager initcode");
assert(/requiredLaunchHookFlags\s*=\s*0x2840n/u.test(deploySource), "deployment does not mine the exact launch hook mask 0x2840");
assert(deploySource.includes('readLaunch("hookPermissionsValid")'), "deployment does not validate deployed hook permissions");
assert(/BigInt\(predicted\)\s*&\s*allHookFlags\)\s*===\s*requiredLaunchHookFlags/u.test(deploySource), "deployment does not enforce the launch hook mask during CREATE2 mining");
for (const validation of [
  "MAX_BOOTSTRAP_BUDGET", "PERMANENT_OTF_CAP", "initialSqrtPriceX96",
  "finalSqrtPriceX96", "derivedLaunchAmounts", "actualFinalReferenceFdvWei",
]) {
  assert(deploySource.includes(validation), `deployment does not validate ${validation}`);
}
for (const setting of ["UNISWAP_V4_POOL_MANAGER_CODEHASH", "UNISWAP_V4_STATE_VIEW_CODEHASH", "UNISWAP_V4_POSITION_MANAGER_CODEHASH", "UNISWAP_V4_QUOTER_CODEHASH", "UNISWAP_UNIVERSAL_ROUTER_CODEHASH", "PERMIT2_CODEHASH"]) {
  assert(deploySource.includes(setting), `deployment does not require ${setting}`);
}
for (const binding of ["StateView PoolManager", "PositionManager PoolManager", "Quoter PoolManager", "Universal Router PoolManager", "Universal Router PositionManager", "PositionManager native wrapper", "Universal Router native wrapper", "Universal Router Permit2"]) {
  assert(deploySource.includes(binding), `deployment does not verify ${binding}`);
}
assert(!existsSync(join(root, "scripts", "formation-snapshot.mjs")), "legacy formation snapshot CLI remains");
console.log(`Security checks passed for ${production.join(", ")}.`);
