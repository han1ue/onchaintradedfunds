import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const contracts = join(root, "contracts");
const runtimeLimit = 24_576;
const initcodeLimit = 49_152;
const production = ["ManagedOTFVault", "OTFFactory", "OTFEntryExitRouter", "FeeCollector", "OTFToken"];
const forbiddenArtifactName = /oracle|nav|pricing|rebalance|strategy|proposal|challenge|adapter|allowlist|pool.?registry/i;
const forbiddenAbiWords = /\b(?:oracle|nav|pricing|rebalance|strategy|proposal|challenge|adapter|allowlist|pool.?registry)\b/i;

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
  if (!forge) throw new Error("forge was not found; install Foundry or set FORGE_BIN");
  return forge;
}

const forge = findForge();
const solhint = join(root, "node_modules", "solhint", "solhint.js");
function runForge(args) { return execFileSync(forge, args, { cwd: contracts, stdio: "inherit" }); }
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
runForge(["build", "--force", "-q"]);
runForge(["lint", "src", "--deny", "warnings"]);

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
  assert(!JSON.stringify(value.abi).match(forbiddenAbiWords), `${name} ABI contains a removed surface`);
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
  "_name", "_symbol", "_decimals", "_totalSupply", "_balanceOf", "_allowance",
  "_initialized", "_shutdown", "_entered", "_factory", "_creator", "_expenseBeneficiary",
  "_feeCollector", "_entryExitRouter", "_annualCreatorExpenseRatioBps", "_formationOtfWeightBps",
  "_formationSnapshotTime", "_formationCalculationVersion", "_formationSnapshotDigest", "_shutdownAt",
  "_assets", "_relativeQuantity", "_accountedBalance", "_feeEpochTimestamp",
  "_lastFeeCheckpointTimestamp", "_feeEpochSupply", "_feeEpochAccruedShares", "_feeShareRemainderWad",
  "_protocolFeeSplitRemainderBps",
];
assert(JSON.stringify(vaultLayout.storage.map((entry) => entry.label)) === JSON.stringify(expectedStorage), "unexpected or legacy vault storage field");

const expectedConstructors = {
  ManagedOTFVault: [],
  FeeCollector: ["initialTreasury"],
  OTFToken: ["initialHolder"],
  OTFFactory: ["vaultImplementation_", "feeCollector_", "formationSnapshotAuthority_", "protocolToken_", "baseProtocolFeeShareBps_", "protocolTokenFullRebateThresholdBps_"],
  OTFEntryExitRouter: ["factory_", "uniswapV3Factory_", "uniswapV3Router_"],
};
for (const [name, expected] of Object.entries(expectedConstructors)) {
  const actual = constructor(compiled[name]);
  assert(actual && actual.inputs.length === expected.length, `${name} constructor arity changed`);
  assert(actual.inputs.every((input, index) => input.name === expected[index]), `${name} constructor fields changed`);
}

const factoryNames = functionNames(compiled.OTFFactory);
for (const name of ["configureEntryExitRouter", "vaultCount", "vaultAt", "formationSnapshotDigest", "predictVaultAddress", "previewRelativeQuantities", "createVault", "effectiveProtocolFeeShareBps", "otfTokenURI", "isVault", "formationNonceUsed"]) {
  assert(factoryNames.has(name), `factory function ${name} is absent`);
}
const createVault = functions(compiled.OTFFactory).find((item) => item.name === "createVault");
assert(createVault.inputs.length === 3 && createVault.inputs[0].type === "tuple" && createVault.inputs[1].type === "tuple" && createVault.inputs[2].type === "bytes", "createVault does not accept params, snapshot, signature");
const snapshotComponents = createVault.inputs[1].components.map((input) => `${input.name}:${input.type}`);
assert(snapshotComponents.join("|") === "chainId:uint256|factory:address|creator:address|constituents:address[]|tokenDecimals:uint8[]|marketCapsUsdWad:uint256[]|unitPricesUsdWad:uint256[]|snapshotTime:uint64|expiry:uint64|calculationVersion:uint32|nonce:uint256", "FormationSnapshot ABI is not the canonical array form");
const factoryCtor = constructor(compiled.OTFFactory);
assert(factoryCtor.inputs.map((input) => input.type).join(",") === "address,address,address,address,uint16,uint16", "factory immutable dependency constructor changed");

const routerFunctions = functions(compiled.OTFEntryExitRouter);
const routerMutating = routerFunctions.filter((item) => !["view", "pure"].includes(item.stateMutability)).map((item) => item.name).sort();
assert(JSON.stringify(routerMutating) === JSON.stringify(["mintFromToken", "redeemToToken", "swapBasketToBasket", "swapDirect"].sort()), "router exposes an untyped mutating entrypoint");
for (const name of ["swapDirect", "mintFromToken", "redeemToToken", "swapBasketToBasket", "factory", "uniswapV3Factory", "uniswapV3Router"]) assert(functionNames(compiled.OTFEntryExitRouter).has(name), `router surface ${name} is absent`);

const sourceConstants = readFileSync(join(contracts, "src", "libraries", "ProtocolConstants.sol"), "utf8");
assert(/MAX_ANNUAL_CREATOR_EXPENSE_RATIO_BPS\s*=\s*1_000/u.test(sourceConstants), "maximum creator fee is not 1000 bps");
assert(/MAX_CONSTITUENTS\s*=\s*20/u.test(sourceConstants), "maximum constituents is not 20");
const routerSource = readFileSync(join(contracts, "src", "OTFEntryExitRouter.sol"), "utf8");
assert(/MAX_CONSTITUENTS\s*=\s*20/u.test(routerSource), "router maximum constituents is not 20");

const tokenNames = functionNames(compiled.OTFToken);
assert(tokenNames.has("MAX_SUPPLY") && tokenNames.has("totalSupply") && tokenNames.has("balanceOf") && tokenNames.has("tokenURI"), "fixed OTF supply surface is incomplete");
assert(![...tokenNames].some((name) => /^(mint|burn|set.*Supply|increaseSupply|decreaseSupply)$/iu.test(name)), "OTF token exposes a mutable supply function");
assert(compiled.OTFToken.abi.filter((item) => item.type === "constructor")[0].inputs[0].type === "address", "OTF token holder constructor changed");

const deploySource = readFileSync(join(root, "scripts", "deploy-robinhood-testnet.mjs"), "utf8");
assert(!forbiddenAbiWords.test(deploySource), "deployment script contains a removed oracle/strategy surface");
assert(/schemaVersion:\s*10/u.test(deploySource), "deployment script does not write schema 10");
assert(/uniswapV3SwapRouter02/u.test(deploySource), "deployment does not require an explicit SwapRouter02 address");
const formationCliSource = readFileSync(join(root, "scripts", "formation-snapshot.mjs"), "utf8");
assert(!/privateKeyToAccount|\.signTypedData\s*\(/u.test(formationCliSource), "offline formation CLI must not handle raw authority keys");
console.log(`Security checks passed for ${production.join(", ")}.`);
