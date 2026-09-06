import { appendFileSync, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contracts = join(root, "contracts");

function fail(message) {
  console.error(`Coverage failed: ${message}`);
  process.exit(1);
}

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
  if (!forge) throw new Error("forge was not found; install Foundry or set FORGE_BIN");
  return forge;
}

const forge = findForge();
// Keep node_modules inside Foundry's root so Solar can resolve dependency-relative imports.
// Test correctness is enforced by the preceding workflow gates; this pass is advisory coverage.
const result = spawnSync(
  forge,
  [
    "coverage",
    "--fuzz-seed",
    process.env.COVERAGE_SEED ?? process.env.FOUNDRY_FUZZ_SEED ?? process.env.CI_FUZZ_SEED
      ?? "0x9f4f6d84b3d23c0d920c3ab72e86e10b72b65a10d6e2c4605aeb1ec8b337c921",
    ...(process.env.COVERAGE_MATCH_PATH ? ["--match-path", process.env.COVERAGE_MATCH_PATH] : []),
    "--root",
    root,
    "--contracts",
    "contracts/src",
    "--out",
    "contracts/out/coverage",
    "--cache-path",
    "contracts/cache/coverage",
    "--lib-paths",
    "contracts/lib",
    "--remappings",
    "@openzeppelin/=node_modules/@openzeppelin/",
    "--remappings",
    "@uniswap/v4-core/=node_modules/@uniswap/v4-core/",
    "--remappings",
    "@uniswap/v4-periphery/=node_modules/@uniswap/v4-periphery/",
    "--remappings",
    "permit2/=node_modules/@uniswap/permit2/",
    "--remappings",
    "solmate/=node_modules/solmate/",
    "--remappings",
    "forge-std/=node_modules/forge-std/src/",
    "--remappings",
    "openzeppelin-contracts/contracts/=node_modules/openzeppelin-contracts/",
    "--use",
    "0.8.26",
    "--evm-version",
    "cancun",
    "--optimize",
    "true",
    "--optimizer-runs",
    "1",
    "--ignored-error-codes",
    "6335",
    "--ir-minimum",
    "--report",
    "summary",
    "--report",
    "lcov",
    "--report-file",
    process.env.COVERAGE_REPORT_FILE ?? "test-results/solidity-coverage.lcov",
    "--no-match-path",
    "contracts/test/{audit,fork}/**",
    "--exclude-tests",
    "--no-match-coverage",
    "(^|/)(mocks|interfaces|node_modules)/",
  ],
  {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      FOUNDRY_TEST: "contracts/test",
      FOUNDRY_SKIP: JSON.stringify([
        "contracts/test/fork/**", "contracts/test/audit/**",
        ...(process.env.COVERAGE_PROFILE === "integration" ? [] : [
          "contracts/test/OTFLaunchV4Integration.t.sol", "contracts/test/OTFLaunchV4Invariant.t.sol",
        ]),
      ]),
      FOUNDRY_FUZZ_RUNS: process.env.FOUNDRY_FUZZ_RUNS ?? "64",
      FOUNDRY_INVARIANT_RUNS: process.env.FOUNDRY_INVARIANT_RUNS ?? "8",
      FOUNDRY_INVARIANT_DEPTH: process.env.FOUNDRY_INVARIANT_DEPTH ?? "32",
      FOUNDRY_INVARIANT_FAIL_ON_REVERT:
        process.env.FOUNDRY_INVARIANT_FAIL_ON_REVERT ?? "true",
      FOUNDRY_BYTECODE_HASH: "none",
      NO_COLOR: "1",
      RUST_LOG: "error",
    },
    maxBuffer: 16 * 1024 * 1024,
  },
);

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

if (result.error) fail(result.error.message);
if (result.status !== 0) {
  fail(
    `forge coverage failed with exit code ${result.status}; no coverage claim was produced`,
  );
}

if (!/^\|\s*Total\s*\|/mu.test(result.stdout)) {
  fail("forge coverage completed without a Total row; refusing an incomplete summary");
}

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    [
      "### Solidity coverage",
      "",
      "> Advisory gap-finding signal generated with Foundry v1.7.1 `--ir-minimum`. "
        + "IR source mappings are approximate and are not a proof of protocol safety.",
      "",
      "```text",
      result.stdout.trim(),
      "```",
      "",
    ].join("\n"),
  );
}
