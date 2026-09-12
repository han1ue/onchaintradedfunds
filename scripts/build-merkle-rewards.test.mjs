import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { buildRewardsArtifact } from "./build-merkle-rewards.mjs";
import { cappedDepositorAllocation, OTF_REWARDS_APY_CAP_PERCENT, OTF_REWARDS_WEEKLY_RATE_CAP_RAW as weeklyRate, parseRewardDecimal as raw, REWARD_SCALE as WAD, weeklyEmissionBucketsRaw } from "./lib/reward-policy.mjs";

const fundCap = 2600n * weeklyRate;

const distributor = "0x00000000000000000000000000000000000000d1";
const account = suffix => `0x${suffix.padStart(40, "0")}`;
const participant = (suffix, amount) => ({ address: account(suffix), amount });
const fund = (suffix = "f1", overrides = {}) => ({
  address: account(suffix), accountedOtf: "10000000", navUsd: "5200",
  depositors: [participant("a1", "1000"), participant("b2", "3000")],
  creators: [participant("c3", "100")], ...overrides,
});
function input(funds = [fund()], week = 1, otfPriceUsd = "2") {
  return { week, otfPriceUsd, snapshot: {
    blockNumber: String(week * 100), blockHash: `0x${week.toString(16).padStart(64, "0")}`,
    timestamp: new Date(Date.UTC(2026, 8, 4 + week * 7)).toISOString(),
    fundAddresses: funds.map(row => row.address),
  }, funds };
}
const build = (data = input(), previous) => buildRewardsArtifact(data, "46630", distributor, previous);
const total = rows => rows.reduce((sum, row) => sum + BigInt(row.allocatedRaw), 0n);

function verifyProofs(artifact) {
  for (const entry of artifact.entries) {
    assert(StandardMerkleTree.verify(artifact.root, ["uint256", "address", "address", "uint256"],
      [artifact.chainId, artifact.distributor, entry.address, entry.cumulativeEntitlementRaw], entry.proof));
  }
}

test("caps weekly depositor rewards, preserves creator rewards, and produces deterministic valid proofs", () => {
  const artifact = build();
  assert.equal(artifact.allocatedRaw.depositors, fundCap.toString());
  assert.equal(artifact.allocatedRaw.creators, raw("100").toString());
  assert.deepEqual(artifact.funds[0].depositors.map(row => row.allocatedRaw), [(fundCap / 4n).toString(), (fundCap * 3n / 4n).toString()]);
  assert.equal(artifact.unallocatedRaw.depositors, (raw("13000000") - fundCap).toString());
  assert.equal(artifact.otfPriceUsd, "2");
  assert.equal(artifact.apyCapPercent, 10000);
  const reordered = input();
  reordered.funds[0].depositors.reverse();
  assert.deepEqual(build(reordered), artifact);
  verifyProofs(artifact);
});

test("chosen weekly price controls token amounts and is preserved exactly", () => {
  const first = build();
  const second = build(input(undefined, 1, "4.000"));
  assert.equal(BigInt(second.allocatedRaw.depositors) * 2n, BigInt(first.allocatedRaw.depositors));
  assert.equal(second.otfPriceUsd, "4.000");
  assert.equal(second.allocatedRaw.creators, first.allocatedRaw.creators);
});

test("shared calculation handles below, exactly at, and above the cap", () => {
  const args = { weeklyDepositorEmissionRaw: weeklyRate, fundNavUsdRaw: raw("2"), otfPriceUsdRaw: raw("2"), fundWeightRaw: WAD, totalWeightRaw: WAD };
  assert.deepEqual(cappedDepositorAllocation(args), { proportionalRaw: weeklyRate, capRaw: weeklyRate, allocatedRaw: weeklyRate, capped: false });
  assert.equal(cappedDepositorAllocation({ ...args, weeklyDepositorEmissionRaw: weeklyRate - 1n }).capped, false);
  const over = cappedDepositorAllocation({ ...args, weeklyDepositorEmissionRaw: weeklyRate + 1n });
  assert(over.capped);
  assert.equal(over.allocatedRaw, weeklyRate);
});

test("weekly rate is the largest 18-decimal rate within the compounded APY cap", () => {
  const limit = (1n + BigInt(OTF_REWARDS_APY_CAP_PERCENT) / 100n) * WAD ** 52n;
  assert((WAD + weeklyRate) ** 52n <= limit);
  assert((WAD + weeklyRate + 1n) ** 52n > limit);
});

test("tiny NAV and proportional participant rounding never exceed the cap", () => {
  const artifact = build(input([fund("f1", { navUsd: "0.000000000000000022", depositors: [participant("a1", "1"), participant("b2", "2")], creators: [] })], 1, "1"));
  assert.equal(artifact.funds[0].depositorLimitRaw, "2");
  assert.equal(artifact.allocatedRaw.depositors, "1");
  assert.equal(artifact.funds[0].depositors[0].allocatedRaw, "0");
  assert(BigInt(artifact.allocatedRaw.depositors) * WAD <= 22n * weeklyRate);
  verifyProofs(artifact);
});

test("caps each fund independently without redistributing excess or changing the 10M weight cap", () => {
  const funds = [fund("f1"), fund("f2", { accountedOtf: "20000000" }), fund("f3", { navUsd: "1000000000", depositors: [participant("e4", "13000000")] })];
  const artifact = build(input(funds));
  assert.equal(artifact.totalWeightRaw, raw("30000000").toString());
  assert.equal(total(artifact.funds[0].depositors), fundCap);
  assert.equal(total(artifact.funds[1].depositors), fundCap);
  assert.equal(total(artifact.funds[2].depositors), raw("13000000") / 3n);
  assert(BigInt(artifact.unallocatedRaw.depositors) > raw("8000000"));
  assert.equal(artifact.entries.find(row => row.address === account("a1")).cumulativeEntitlementRaw, (fundCap / 2n).toString());
});

test("does not increase proposed allocations that are below the allowance", () => {
  const artifact = build(input([fund("f1", { depositors: [participant("a1", "0.5")] })]));
  assert.equal(artifact.allocatedRaw.depositors, raw("0.5").toString());
});

test("zero NAV, zero OTF weight, and an empty roster allocate zero depositor rewards", () => {
  for (const row of [fund("f1", { navUsd: "0", creators: [] }), fund("f1", { accountedOtf: "0", creators: [] })]) {
    const artifact = build(input([row]));
    assert.equal(artifact.allocatedRaw.depositors, "0");
    assert.deepEqual(artifact.entries, []);
    assert.equal(artifact.root, `0x${"0".repeat(64)}`);
  }
  const empty = build(input([]));
  assert.equal(empty.unallocatedRaw.total, raw("14000000").toString());
  assert.equal(build(input([], 2), empty).allocatedRaw.total, "0");
  assert.equal(build(input([fund("f1", { navUsd: "0" })])).allocatedRaw.creators, raw("100").toString());
});

test("adds weekly increments to cumulative claims, retains past recipients, and never rolls unused rewards forward", () => {
  const first = build();
  const second = build(input([fund("f1", { depositors: [participant("a1", "10000")], creators: [] })], 2, "4"), first);
  assert.equal(second.entries.find(row => row.address === account("a1")).cumulativeEntitlementRaw, (fundCap * 3n / 4n).toString());
  assert.equal(second.entries.find(row => row.address === account("b2")).cumulativeEntitlementRaw, (fundCap * 3n / 4n).toString());
  assert.equal(second.cumulativeAllocatedRaw.depositors, (fundCap * 3n / 2n).toString());
  assert.equal(second.budgetRaw.depositors, weeklyEmissionBucketsRaw(2).depositors.toString());
  assert.equal(second.previousRoot, first.root);
  verifyProofs(second);
  // A later claim pays the new cumulative entitlement less what was claimed before.
  assert.equal(BigInt(second.entries[0].cumulativeEntitlementRaw) - BigInt(first.entries[0].cumulativeEntitlementRaw), fundCap / 2n);
});

test("requires a chosen positive decimal price and complete valuation data", () => {
  for (const value of [undefined, null, 0, 2, NaN, Infinity, "0", "-1", "Infinity", "NaN", "1e18", "1.0000000000000000001", "1.", "", "9".repeat(80)]) {
    const data = input(); data.otfPriceUsd = value;
    assert.throws(() => build(data), /price|uint256/u);
  }
  for (const field of ["navUsd", "accountedOtf", "depositors", "creators"]) {
    const data = input(); delete data.funds[0][field];
    assert.throws(() => build(data));
  }
  assert.throws(() => build([]), /Weekly JSON input/u);
});

test("rejects duplicate funds or participants, incomplete rosters, and malformed amounts or identities", () => {
  const duplicateFund = input(); duplicateFund.funds.push({ ...duplicateFund.funds[0], address: account("F1") });
  assert.throws(() => build(duplicateFund), /Duplicate fund/u);
  const duplicateUser = input(); duplicateUser.funds[0].depositors.push(participant("A1", "1"));
  assert.throws(() => build(duplicateUser), /Duplicate depositor/u);
  const missing = input(); missing.snapshot.fundAddresses.push(account("f2"));
  assert.throws(() => build(missing), /roster/u);
  const extra = input(); extra.snapshot.fundAddresses = [];
  assert.throws(() => build(extra), /roster/u);
  const duplicateRoster = input(); duplicateRoster.snapshot.fundAddresses.push(account("f1"));
  assert.throws(() => build(duplicateRoster), /Duplicate snapshot/u);
  for (const amount of ["-1", "1e18", "", "1.", 1]) {
    assert.throws(() => build(input([fund("f1", { depositors: [participant("a1", amount)] })])), /amount/u);
  }
  assert.throws(() => build(input([fund("f1", { address: "0x123" })])), /address/u);
  assert.throws(() => buildRewardsArtifact(input(), "0", distributor), /Chain ID/u);
  assert.throws(() => buildRewardsArtifact(input(), "46630", account("0")), /distributor/u);
  assert.throws(() => build(input([fund("f1", { creators: [participant("c3", "1000001")] })])), /Creator rewards exceed/u);
});

test("rejects missing history, repeated weeks, gaps, mismatched identity, and inconsistent previous artifacts", () => {
  const first = build();
  assert.throws(() => build(input(undefined, 2)), /Previous artifact/u);
  assert.throws(() => build(input(), first), /Week one/u);
  assert.throws(() => build(input(undefined, 3), first), /consecutive/u);
  assert.throws(() => build(input(undefined, 0)), /Week must/u);
  assert.throws(() => build(input(undefined, 209)), /Week must/u);
  assert.throws(() => build(input(undefined, 2), { ...first, chainId: "1" }), /mismatch/u);
  assert.throws(() => build(input(undefined, 2), { ...first, distributor: account("d2") }), /mismatch/u);
  const badTotals = structuredClone(first); badTotals.cumulativeAllocatedRaw.depositors = "0";
  assert.throws(() => build(input(undefined, 2), badTotals), /totals/u);
  const badRoot = structuredClone(first); badRoot.root = `0x${"1".repeat(64)}`;
  assert.throws(() => build(input(undefined, 2), badRoot), /root/u);
  const stale = input(undefined, 2); stale.snapshot = first.snapshot;
  assert.throws(() => build(stale, first), /advance/u);
});

test("reconciles all 208 scheduled budgets exactly, independent of actual payouts", () => {
  const weeks = Array.from({ length: 208 }, (_, index) => weeklyEmissionBucketsRaw(index + 1));
  assert.equal(weeks.reduce((sum, row) => sum + row.depositors, 0n), raw("650000000"));
  assert.equal(weeks.reduce((sum, row) => sum + row.creators, 0n), raw("50000000"));
  assert.deepEqual(weeklyEmissionBucketsRaw(209), { total: 0n, depositors: 0n, creators: 0n });
});

test("CLI writes reviewable artifacts, accepts history, and refuses legacy inputs or overwriting output", () => {
  const directory = mkdtempSync(join(tmpdir(), "otf-rewards-"));
  try {
    const source = join(directory, "week.json"), output = join(directory, "artifact.json"), next = join(directory, "next.json");
    const run = (sourcePath = source, outputPath = output, extra = []) => spawnSync(process.execPath,
      [resolve("scripts/build-merkle-rewards.mjs"), "--input", sourcePath, "--output", outputPath, "--chain-id", "46630", "--distributor", distributor, ...extra], { encoding: "utf8" });
    writeFileSync(source, JSON.stringify(input()));
    assert.equal(run().status, 0);
    assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), build());
    assert.notEqual(run().status, 0);
    writeFileSync(source, JSON.stringify(input(undefined, 2)));
    assert.equal(run(source, next, ["--previous", output]).status, 0);
    assert.equal(JSON.parse(readFileSync(next, "utf8")).week, 2);
    assert.match(run(join(directory, "legacy.csv")).stderr, /must be JSON/u);
    writeFileSync(source, "[]");
    assert.match(run(source, next).stderr, /Weekly JSON input/u);
  } finally {
    assert(directory.startsWith(join(tmpdir(), "otf-rewards-")));
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the documented weekly JSON example generates the stated payouts", () => {
  const prose = readFileSync("docs/content/token-and-fee-incentives.mdx", "utf8");
  const match = prose.match(/```json\r?\n([\s\S]*?)\r?\n```/u);
  assert(match, "Weekly JSON example is missing.");
  const artifact = build(JSON.parse(match[1]));
  assert.equal(artifact.allocatedRaw.depositors, fundCap.toString());
  assert.equal(artifact.allocatedRaw.creators, raw("100").toString());
  verifyProofs(artifact);
});
