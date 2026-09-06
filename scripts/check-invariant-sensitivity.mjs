import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const forge = process.env.FORGE_BIN ?? join(homedir(), ".foundry", "bin", process.platform === "win32" ? "forge.exe" : "forge");
const output = join(root, "test-results", "invariant-sensitivity");
mkdirSync(output, { recursive: true });
for (const profile of ["default", "integration"]) {
  for (const [flag, marker] of [["INVARIANT_SENTINEL_ASSERT", "SENTINEL_HANDLER_ASSERTION"], ["INVARIANT_SENTINEL_REVERT", "SentinelUnexpectedRevert"]]) {
    const result = spawnSync(forge, ["test", "--match-path", "test/InvariantSensitivity.t.sol", "--match-contract", "^InvariantSensitivityTest$", "--fuzz-seed", "0x1234", "-vv"], {
      cwd: join(root, "contracts"), encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, FOUNDRY_PROFILE: profile, FOUNDRY_INVARIANT_RUNS: "1", FOUNDRY_INVARIANT_DEPTH: "1", [flag]: "true" },
    });
    const log = (result.stdout ?? "") + (result.stderr ?? "");
    writeFileSync(join(output, `${profile}-${flag}.log`), log);
    if (result.error || result.status !== 1 || !log.includes(marker) || !log.includes("[FAIL")) {
      throw new Error(`${profile}/${flag}: sensitivity check did not fail as intended: ${result.error ?? log}`);
    }
    console.log(`${profile}/${flag}: confirmed failing handler makes Forge exit 1`);
  }
}
