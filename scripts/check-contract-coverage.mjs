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

if (process.platform === "win32") {
  fail(
    "Coverage is pinned to Linux CI: Foundry v1.7.1 Solar cannot resolve this project's "
      + "OpenZeppelin relative imports reliably on Windows. Run the Solidity security workflow "
      + "or use a Linux environment.",
  );
}

const forge = findForge();
const result = spawnSync(
  forge,
  [
    "coverage",
    "--ir-minimum",
    "--report",
    "summary",
    "--exclude-tests",
    "--no-match-coverage",
    "(^|/)(mocks|interfaces)/",
  ],
  {
    cwd: contracts,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
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
