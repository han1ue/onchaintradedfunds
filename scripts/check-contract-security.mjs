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
        /(?:ManagedOTFVault|ManagedOTFVaultStrategy|ManagedOTFVaultStorage)\./g,
        "OTF.",
      ),
    };
  });
}

runForge(["build", "--force", "-q"]);

const vaultLayout = normalizedStorage(
  artifact("ManagedOTFVault.sol", "ManagedOTFVault").storageLayout,
);
const strategyLayout = normalizedStorage(
  artifact("ManagedOTFVaultStrategy.sol", "ManagedOTFVaultStrategy").storageLayout,
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

const productionContracts = [
  ["AssetRegistry.sol", "AssetRegistry"],
  ["FeeCollector.sol", "FeeCollector"],
  ["ManagedOTFVault.sol", "ManagedOTFVault"],
  ["ManagedOTFVaultStrategy.sol", "ManagedOTFVaultStrategy"],
  ["OracleRegistry.sol", "OracleRegistry"],
  ["OTFFactory.sol", "OTFFactory"],
  ["PortfolioCalculator.sol", "PortfolioCalculator"],
  ["RebalanceExecutor.sol", "RebalanceExecutor"],
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
const vaultFunctions = vault.abi.filter((item) => item.type === "function").map((item) => item.name);
const strategyFunctions = strategy.abi
  .filter((item) => item.type === "function")
  .map((item) => item.name);

assert(!vaultFunctions.includes("execute"), "generic execute function found in vault ABI");
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

console.log(
  `Contract security checks passed: ${canonicalLayout.length} canonical storage entries and ${productionContracts.length} production bytecode limits verified.`,
);
