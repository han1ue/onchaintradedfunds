import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import solc from "solc";

const root = process.cwd();
const contractsSrc = join(root, "contracts", "src");
const contractsTest = join(root, "contracts", "test");
const nodeModules = join(root, "node_modules");

function solidityFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) return solidityFiles(fullPath);
    return entry.isFile() && entry.name.endsWith(".sol") ? [fullPath] : [];
  });
}

const includeTests = process.env.SOLC_INCLUDE_TESTS !== "false";
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
    // Robinhood Chain Testnet supports Shanghai opcodes but currently rejects
    // Cancun-only bytecode such as MCOPY during contract creation.
    evmVersion: "shanghai",
    optimizer: { enabled: true, runs: 1 },
    metadata: { bytecodeHash: "none" },
    viaIR: true,
    outputSelection: {
      "*": {
        "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"],
      },
    },
  },
};

function resolveImport(importPath) {
  if (!importPath.startsWith("@openzeppelin/")) {
    return { error: `Unsupported external Solidity import: ${importPath}` };
  }

  const dependencyPath = join(nodeModules, ...importPath.split("/"));
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
        },
        null,
        2,
      )}\n`,
    );
  }
}

console.log(`Compiled ${Object.keys(sources).length} Solidity source files with solc ${solc.version()}.`);
