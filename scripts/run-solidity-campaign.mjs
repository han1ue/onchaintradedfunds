import { spawnSync } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { mkdirSync, writeFileSync, appendFileSync, readdirSync, readFileSync, openSync, closeSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const forge = process.env.FORGE_BIN ?? join(homedir(), ".foundry", "bin", process.platform === "win32" ? "forge.exe" : "forge");
const seed = process.env.CAMPAIGN_SEED ?? `0x${randomBytes(32).toString("hex")}`;
if (!/^0x[0-9a-fA-F]{1,64}$/u.test(seed)) throw new Error("CAMPAIGN_SEED must be a hex uint256");
const profiles = process.env.CAMPAIGN_PROFILE ? [process.env.CAMPAIGN_PROFILE] : ["default", "integration"];
if (profiles.some((p) => !["default", "integration"].includes(p))) throw new Error("Unknown profile");
const output = join(root, "test-results", "campaign", `${new Date().toISOString().replace(/[:.]/gu, "-")}-${seed.slice(2, 10)}`);
mkdirSync(output, { recursive: true });
const version = spawnSync(forge, ["--version"], { encoding: "utf8" });
if (version.status !== 0) throw new Error("Forge unavailable");
function solidityFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? solidityFiles(path) : entry.name.endsWith(".sol") ? [path] : [];
  });
}
const sourceHash = createHash("sha256");
for (const path of [...solidityFiles(join(root, "contracts", "src")), ...solidityFiles(join(root, "contracts", "test")), join(root, "contracts", "foundry.toml"), join(root, "pnpm-lock.yaml")].sort()) {
  sourceHash.update(path.slice(root.length).replaceAll("\\", "/")); sourceHash.update(readFileSync(path));
}
const manifest = { sourceSha256: sourceHash.digest("hex"), seed, forge: version.stdout.trim(), gitHead: spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim(), campaigns: [] };
let failed = false;
for (const profile of profiles) {
  const runs = process.env.CAMPAIGN_RUNS ?? "128";
  const depth = process.env.CAMPAIGN_DEPTH ?? "64";
  const fuzz = process.env.CAMPAIGN_FUZZ_RUNS ?? (profile === "integration" ? "64" : "1000");
  for (const value of [runs, depth, fuzz]) if (!/^[1-9][0-9]*$/u.test(value)) throw new Error("Campaign sizes must be positive integers");
  const args = ["test", "--fuzz-seed", seed, "--fuzz-runs", fuzz, "-vv", "--summary"];
  if (profile === "default") args.push("--no-match-path", "test/audit/**");
  if (profile === "default" && process.env.CAMPAIGN_MATCH_PATH) args.push("--match-path", process.env.CAMPAIGN_MATCH_PATH);
  if (profile === "integration") args.push("--match-path", "test/OTFLaunchV4*.t.sol");
  const env = { FOUNDRY_PROFILE: profile, FOUNDRY_INVARIANT_RUNS: runs, FOUNDRY_INVARIANT_DEPTH: depth, FOUNDRY_INVARIANT_FAIL_ON_REVERT: "true", FOUNDRY_INVARIANT_SHOW_METRICS: "true" };
  const entry = { profile, args, env, startedAt: new Date().toISOString(), requested: { runs: Number(runs), depth: Number(depth), fuzz: Number(fuzz) } };
  manifest.campaigns.push(entry);
  writeFileSync(join(output, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`${profile}: seed=${seed}, invariants=${runs} x ${depth}, fuzz=${fuzz}`);
  const start = performance.now();
  const logPath = join(output, `${profile}.log`);
  const logFd = openSync(logPath, "w");
  const result = spawnSync(forge, args, { cwd: join(root, "contracts"), env: { ...process.env, ...env }, stdio: ["ignore", logFd, logFd] });
  closeSync(logFd);
  const log = readFileSync(logPath, "utf8");
  entry.runtimeSeconds = Number(((performance.now() - start) / 1000).toFixed(3));
  entry.exitCode = result.status;
  entry.actual = [];
  entry.actions = [];
  entry.fuzz = [];
  entry.tests = { passed: 0, failed: 0, skipped: 0 };
  let suite;
  let property;
  for (const line of log.split(/\r?\n/u)) {
    const header = line.match(/^Ran \d+ tests? for (.*)$/u);
    if (header) { suite = header[1]; property = undefined; }
    const m = line.match(/\[(PASS|FAIL[^\]]*)\] ([^\r\n]+?) \(runs: (\d+), calls: (\d+), reverts: (\d+)\)/u);
    if (m) {
      property = m[2];
      entry.actual.push({ suite, status: m[1], property, runs: Number(m[3]), calls: Number(m[4]), reverts: Number(m[5]), observedDepth: Number(m[3]) ? Number(m[4]) / Number(m[3]) : 0 });
    }
    const action = line.match(/^\|\s*(\S+)\s*\|\s*(\S+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|/u);
    if (action && property) entry.actions.push({ suite, property, handler: action[1], selector: action[2], calls: Number(action[3]), reverts: Number(action[4]), discards: Number(action[5]) });
    const fuzzResult = line.match(/\[(PASS|FAIL[^\]]*)\] (.+?) \(runs: (\d+), μ:/u);
    if (fuzzResult) entry.fuzz.push({ suite, status: fuzzResult[1], property: fuzzResult[2], runs: Number(fuzzResult[3]) });
    const totals = line.match(/^Suite result: .*? (\d+) passed; (\d+) failed; (\d+) skipped;/u);
    if (totals) { entry.tests.passed += Number(totals[1]); entry.tests.failed += Number(totals[2]); entry.tests.skipped += Number(totals[3]); }
  }
  entry.compilerSeconds = Number(log.match(/Solc [\d.]+ finished in ([\d.]+)s/u)?.[1] ?? 0);
  entry.suites = log.split(/\r?\n/u).filter((line) => line.startsWith("Suite result:") || /^Ran \d+ test suites/u.test(line));
  entry.actionMetrics = "See .log for aggregate selector calls/reverts; Solidity counters describe the final sequence, including fixture calls.";
  writeFileSync(join(output, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`${profile}: exit=${result.status}, runtime=${entry.runtimeSeconds}s, invariant results=${entry.actual.length}, log=${output}`);
  if (result.error || result.status !== 0 || entry.actual.length === 0) failed = true;
}
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\nCampaign seed: \`${seed}\`\n\n\`\`\`json\n${JSON.stringify(manifest, null, 2)}\n\`\`\`\n`);
process.exitCode = failed ? 1 : 0;
