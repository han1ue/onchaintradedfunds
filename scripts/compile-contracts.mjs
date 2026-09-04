import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import solc from "solc";

const root = process.cwd();
const contractsSrc = join(root, "contracts", "src");
const contractsTest = join(root, "contracts", "test");
const artifactsRoot = join(root, "contracts", "out");
const nodeModules = join(root, "node_modules");

function solidityFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) return solidityFiles(fullPath);
    return entry.isFile() && entry.name.endsWith(".sol") ? [fullPath] : [];
  });
}

const includeTests = process.env.SOLC_INCLUDE_TESTS === "true";
const sourceFiles = includeTests
  ? [...solidityFiles(contractsSrc), ...solidityFiles(contractsTest)]
  : solidityFiles(contractsSrc);

const sources = Object.fromEntries(
  sourceFiles.map((file) => {
    const key = relative(root, file).split(sep).join("/");
    return [key, { content: readFileSync(file, "utf8") }];
  }),
);

const input = {
  language: "Solidity",
  sources,
  settings: {
    evmVersion: "cancun",
    optimizer: { enabled: true, runs: 1 },
    metadata: { bytecodeHash: "none" },
    viaIR: process.env.SOLC_VIA_IR !== "false",
    outputSelection: {
      "*": {
        "*": [
          "abi",
          "evm.bytecode.object",
          "evm.deployedBytecode.object",
          "storageLayout",
          "evm.methodIdentifiers",
        ],
      },
    },
  },
};

function resolveImport(importPath) {
  const dependencyPath = importPath.startsWith("permit2/")
    ? join(nodeModules, "@uniswap", "v4-periphery", "lib", ...importPath.split("/"))
    : importPath.startsWith("solmate/")
      ? join(nodeModules, "@uniswap", "v4-periphery", "lib", ...importPath.split("/"))
      : importPath.startsWith("forge-std/")
        ? join(nodeModules, "@uniswap", "v4-periphery", "lib", "v4-core", "lib", "forge-std", "src", ...importPath.split("/").slice(1))
      : join(nodeModules, ...importPath.split("/"));
  try {
    return { contents: readFileSync(dependencyPath, "utf8") };
  } catch {
    return { error: `Solidity dependency not found: ${importPath}` };
  }
}

const output = JSON.parse(solc.compile(JSON.stringify(input), { import: resolveImport }));
const errors = output.errors ?? [];
for (const diagnostic of errors) {
  const prefix = diagnostic.severity === "error" ? "error" : "warning";
  console.error(`${prefix}: ${diagnostic.formattedMessage}`);
}

if (errors.some((diagnostic) => diagnostic.severity === "error")) {
  process.exit(1);
}

// The compiler output is a disposable source-of-truth. Removing it first prevents deleted
// production contracts from surviving in artifacts and being consumed by deployment tooling.
rmSync(artifactsRoot, { recursive: true, force: true });

for (const [source, contracts] of Object.entries(output.contracts ?? {})) {
  for (const [contractName, compiled] of Object.entries(contracts)) {
    const artifactDir = join(root, "contracts", "out", basename(source));
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(
      join(artifactDir, `${contractName}.json`),
      `${JSON.stringify(
        {
          abi: compiled.abi,
          bytecode: compiled.evm.bytecode,
          deployedBytecode: compiled.evm.deployedBytecode,
          storageLayout: compiled.storageLayout,
          methodIdentifiers: compiled.evm.methodIdentifiers,
        },
        null,
        2,
      )}\n`,
    );
  }
}

console.log(`Compiled ${Object.keys(sources).length} Solidity source files with solc ${solc.version()}.`);
