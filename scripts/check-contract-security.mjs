import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const contracts = join(root, "contracts");
const runtimeLimit = 24_576;
const initcodeLimit = 49_152;
const production = [
  "ManagedOTFVault", "OTFFactory", "OTFEntryExitRouter", "UniswapV3Adapter", "UniswapV4Adapter",
  "OTFToken", "OTFLaunchManager", "OTFLaunchManagerDeployer", "TeamMarketCapVesting",
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
  "_initialized", "_shutdown", "_entered", "_factory", "_creator", "_expenseBeneficiary",
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
assert(!existsSync(join(contracts, "src", "ERC20Base.sol")), "hand-written ERC20Base remains in production sources");
assert(/ManagedOTFVaultStorage is ERC20Upgradeable/u.test(vaultStorageSource), "vault shares do not use OpenZeppelin ERC20Upgradeable");
assert(
  /_disableInitializers\(\)/u.test(vaultSource)
    && /external initializer nonReentrant/u.test(vaultSource)
    && /__ERC20_init\(params\.name, params\.symbol\)/u.test(vaultSource),
  "vault ERC20 initialization is not clone-safe and implementation-locked",
);
assert(
  /import\s*\{\s*ERC20Burnable\s*\}\s*from\s*[\r\n\s]*"@openzeppelin\/contracts\/token\/ERC20\/extensions\/ERC20Burnable\.sol"/u.test(otfTokenSource)
    && /OTFToken is ERC20Burnable/u.test(otfTokenSource),
  "OTFToken does not inherit OpenZeppelin ERC20Burnable directly",
);
assert(!/function\s+burn(?:From)?\s*\(/u.test(otfTokenSource), "OTFToken hand-writes a burn function");

const expectedConstructors = {
  ManagedOTFVault: [],
  OTFToken: ["initialHolder"],
  OTFFactory: ["vaultImplementation_", "buybackCollector_", "otfToken_"],
  OTFEntryExitRouter: ["factory_", "initialAdapterManager", "weth_"],
  UniswapV3Adapter: ["entryExitRouter_", "uniswapV3Factory_", "uniswapV3Router_"],
  UniswapV4Adapter: ["entryExitRouter_", "uniswapV4PoolManager_", "uniswapV4StateView_", "uniswapUniversalRouter_", "permit2_"],
  OTFLaunchManager: ["otf_", "weth_", "poolManager_", "stateView_", "positionManager_", "permit2_"],
  OTFLaunchManagerDeployer: [],
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

const routerFunctions = functions(compiled.OTFEntryExitRouter);
const routerMutating = routerFunctions.filter((item) => !["view", "pure"].includes(item.stateMutability)).map((item) => item.name).sort();
assert(JSON.stringify(routerMutating) === JSON.stringify(["acceptOwnership", "mintFromNative", "mintFromToken", "redeemToNative", "redeemToToken", "renounceOwnership", "setAdapterApproved", "swapBasketToBasket", "swapFeeSharesToWeth", "transferOwnership"].sort()), "router exposes an unexpected mutating entrypoint");
for (const name of ["mintFromNative", "mintFromToken", "redeemToNative", "redeemToToken", "swapBasketToBasket", "swapFeeSharesToWeth", "factory", "weth", "isAdapterApproved", "setAdapterApproved", "owner", "pendingOwner"]) assert(functionNames(compiled.OTFEntryExitRouter).has(name), `router surface ${name} is absent`);
assert(!functionNames(compiled.OTFEntryExitRouter).has("swapDirect"), "router retains swapDirect");
const mintFromToken = routerFunctions.find((item) => item.name === "mintFromToken");
const swapLeg = mintFromToken.inputs[1];
assert(swapLeg.type === "tuple[]", "router legs are not a generic tuple array");
assert(swapLeg.components.map((input) => `${input.name}:${input.type}`).join("|") === "adapter:address|tokenIn:address|tokenOut:address|amountIn:uint256|minAmountOut:uint256|data:bytes", "router SwapLeg is not the bounded adapter interface");

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
assert(/MAX_CONSTITUENTS\s*=\s*20/u.test(sourceConstants), "maximum constituents is not 20");
assert(/MAX_FUND_THESIS_BYTES\s*=\s*2_048/u.test(sourceConstants), "maximum fund thesis is not 2048 bytes");
assert(/MINIMUM_SHARE_SUPPLY\s*=\s*1e16/u.test(sourceConstants), "bootstrap and shutdown threshold is not 0.01 OTF");
const routerSource = readFileSync(join(contracts, "src", "OTFEntryExitRouter.sol"), "utf8");
assert(/msg\.sender\s*!=\s*IOTFSettlementFactory\(factory\)\.buybackCollector\(\)/u.test(routerSource), "fee-share sale is not restricted to the factory collector");
assert(/MAX_CONSTITUENTS\s*=\s*20/u.test(routerSource), "router maximum constituents is not 20");
const adapterSource = readFileSync(join(contracts, "src", "UniswapV3Adapter.sol"), "utf8");
const v4AdapterSource = readFileSync(join(contracts, "src", "UniswapV4Adapter.sol"), "utf8");
assert(!/delegatecall/u.test(routerSource + adapterSource + v4AdapterSource), "router or adapter contains delegatecall execution");
assert(!/function\s+execute\s*\(\s*address\s+target/iu.test(routerSource + adapterSource + v4AdapterSource), "router or adapter exposes an arbitrary target");
assert(/recipient:\s*entryExitRouter/u.test(adapterSource), "V3 adapter recipient is not fixed to the entry router");
assert(/abi\.decode\(data,\s*\(UniswapV4PathKey\[\]\)\)/u.test(v4AdapterSource), "V4 adapter data is not a typed pool-key path");
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
for (const name of ["configureFactory", "configureEntryExitRouter", "registerVault", "recordFeeShares", "settleFeesViaRedemption", "settleFeesViaShareSale", "feeAccounts"]) {
  assert(buybackNames.has(name), `buyback collector function ${name} is absent`);
}
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
assert(/MAX_SUPPLY\s*=\s*1_000_000_000 ether/u.test(launchSource), "launch reference supply changed");
assert(/BOOTSTRAP_ALLOCATION\s*=\s*150_000_000 ether/u.test(launchSource), "bootstrap allocation changed");
assert(/PERMANENT_LIQUIDITY_RESERVE\s*=\s*50_000_000 ether/u.test(launchSource), "permanent-liquidity reserve changed");
assert(/LAUNCH_REFERENCE_FDV_WEI\s*=\s*20 ether/u.test(launchSource), "launch reference FDV is not 20 ETH");
assert(/TARGET_REFERENCE_FDV_WEI\s*=\s*180 ether/u.test(launchSource), "target reference FDV is not 180 ETH");
for (const constant of [
  "-177_284", "-155_311", "11_204_554_194_957_227_983_746_388",
  "33_613_418_706_697_289_737_079_801", "177_284", "155_311",
  "560_227_709_747_861_399_187_319_382_274_581",
  "186_743_924_804_530_596_371_038_112_052_313",
]) {
  assert(launchSource.includes(constant), `launch manager is missing derived curve constant ${constant}`);
}
assert(/BEFORE_INITIALIZE_FLAG\s*=\s*1\s*<<\s*13/u.test(launchSource), "launch manager is missing the beforeInitialize hook flag");
assert(/REQUIRED_HOOK_FLAGS\s*=\s*BEFORE_INITIALIZE_FLAG\s*\|\s*AFTER_SWAP_FLAG/u.test(launchSource), "launch manager hook permissions are not exactly beforeInitialize + afterSwap");
assert(/&\s*ALL_HOOK_MASK\s*==\s*REQUIRED_HOOK_FLAGS/u.test(launchSource), "launch manager does not enforce the exact required hook flags");
assert(/function\s+beforeInitialize\s*\(\s*address\s+initializer,\s*UniswapV4PoolKey\s+calldata,\s*uint160\s*\)/u.test(launchSource), "launch manager is missing the typed beforeInitialize callback");
assert(/msg\.sender\s*!=\s*poolManager/u.test(launchSource), "launch callbacks do not authenticate the immutable PoolManager");
assert(/initializer\s*!=\s*address\(this\)/u.test(launchSource), "launch manager does not reject non-self pool initializers");

const deploySource = readFileSync(join(root, "scripts", "deploy-robinhood-testnet.mjs"), "utf8");
assert(/uniswapV3SwapRouter02/u.test(deploySource), "deployment does not require an explicit SwapRouter02 address");
assert(/deploy\("UniswapV3Adapter"/u.test(deploySource), "deployment does not deploy UniswapV3Adapter");
assert(/deploy\("UniswapV4Adapter"/u.test(deploySource), "deployment does not deploy UniswapV4Adapter");
assert((deploySource.match(/"setAdapterApproved"/gu) ?? []).length === 2, "deployment does not approve both adapters");
for (const name of ["OTFToken", "TeamMarketCapVesting", "BuybackCollector", "MerkleRewardsDistributor", "FakeETHUSDOracle"]) {
  assert(deploySource.includes(`deploy(\"${name}\"`), `deployment does not deploy ${name}`);
}
assert(/functionName:\s*"beneficiary"/u.test(deploySource) && /functionName:\s*"pendingBeneficiary"/u.test(deploySource), "deployment does not verify initial team beneficiary state");
const testnetConfig = JSON.parse(readFileSync(join(root, "app", "src", "config", "robinhood-testnet.json"), "utf8"));
assert(testnetConfig.trustedRoles.teamBeneficiary === "0xc340D7085E321B82CF550904310EE44bae9e4CD2", "configured testnet team beneficiary changed");
assert(!("architecture" in testnetConfig), "testnet configuration must not use an architecture version gate");
assert(testnetConfig.status === "not-deployed" || testnetConfig.status === "deployed", "testnet configuration has an invalid deployment status");
if (testnetConfig.status === "not-deployed") {
  assert(Object.keys(testnetConfig.contracts).length === 0, "undeployed testnet configuration contains protocol addresses");
} else {
  assert(testnetConfig.launch.launchReferenceFdvWei === "20000000000000000000", "deployed testnet launch reference FDV mismatch");
  assert(testnetConfig.launch.targetReferenceFdvWei === "180000000000000000000", "deployed testnet target reference FDV mismatch");
}
const mainnetConfig = JSON.parse(readFileSync(join(root, "app", "src", "config", "robinhood-mainnet.json"), "utf8"));
assert(!("architecture" in mainnetConfig), "mainnet configuration must not use an architecture version gate");
assert(/type\(OTFLaunchManager\)|bytecode\("OTFLaunchManager"\)/u.test(deploySource), "deployment does not construct OTFLaunchManager initcode");
assert(/requiredLaunchHookFlags\s*=\s*0x2040n/u.test(deploySource), "deployment does not mine the exact launch hook mask 0x2040");
assert(/BigInt\(predicted\)\s*&\s*allHookFlags\)\s*===\s*requiredLaunchHookFlags/u.test(deploySource), "deployment does not enforce the launch hook mask during CREATE2 mining");
for (const validation of [
  "LAUNCH_REFERENCE_FDV_WEI", "TARGET_REFERENCE_FDV_WEI", "initialSqrtPriceX96",
  "finalSqrtPriceX96", "bootstrap WETH proceeds", "actualFinalReferenceFdvWei",
]) {
  assert(deploySource.includes(validation), `deployment does not validate ${validation}`);
}
for (const setting of ["UNISWAP_V4_POOL_MANAGER_CODEHASH", "UNISWAP_V4_STATE_VIEW_CODEHASH", "UNISWAP_V4_POSITION_MANAGER_CODEHASH", "UNISWAP_V4_QUOTER_CODEHASH", "UNISWAP_UNIVERSAL_ROUTER_CODEHASH", "PERMIT2_CODEHASH"]) {
  assert(deploySource.includes(setting), `deployment does not require ${setting}`);
}
for (const binding of ["StateView PoolManager", "PositionManager PoolManager", "Quoter PoolManager", "Universal Router PoolManager", "Universal Router PositionManager", "Universal Router WETH", "Universal Router Permit2"]) {
  assert(deploySource.includes(binding), `deployment does not verify ${binding}`);
}
assert(!existsSync(join(root, "scripts", "formation-snapshot.mjs")), "legacy formation snapshot CLI remains");
console.log(`Security checks passed for ${production.join(", ")}.`);
