import { readFileSync, writeFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import {
  cappedDepositorAllocation, formatRewardDecimal, parseRewardDecimal,
  OTF_INCENTIVE_WEEKS, OTF_REWARD_WEIGHT_CAP, OTF_REWARDS_APY_CAP_PERCENT,
  REWARD_SCALE, UINT256_MAX, weeklyEmissionBucketsRaw,
} from "./lib/reward-policy.mjs";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const HASH = /^0x[0-9a-fA-F]{64}$/u;
const ZERO_ROOT = `0x${"0".repeat(64)}`;
const SCHEMA = "otf-weekly-rewards-v2";
const LEAF_TYPES = ["uint256", "address", "address", "uint256"];
const sum = values => values.reduce((total, value) => total + value, 0n);
const rawTotals = (depositors, creators) => ({ depositors: String(depositors), creators: String(creators), total: String(depositors + creators) });

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function address(value, label) {
  if (typeof value !== "string" || !ADDRESS.test(value) || /^0x0{40}$/u.test(value)) throw new Error(`Invalid ${label} address.`);
  return value.toLowerCase();
}

function rawAmount(value, label) {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/u.test(value) || BigInt(value) > UINT256_MAX) {
    throw new Error(`Invalid ${label} raw amount.`);
  }
  return BigInt(value);
}

function snapshot(value) {
  object(value, "Snapshot");
  rawAmount(value.blockNumber, "snapshot block number");
  if (typeof value.blockHash !== "string" || !HASH.test(value.blockHash) || value.blockHash === ZERO_ROOT) throw new Error("Invalid snapshot block hash.");
  if (typeof value.timestamp !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/u.test(value.timestamp)
    || !Number.isFinite(Date.parse(value.timestamp))) throw new Error("Invalid snapshot timestamp; use UTC ISO format.");
  if (!Array.isArray(value.fundAddresses)) throw new Error("Snapshot must include the complete factory fundAddresses roster.");
  const fundAddresses = value.fundAddresses.map(value => address(value, "snapshot fund")).sort();
  if (new Set(fundAddresses).size !== fundAddresses.length) throw new Error("Duplicate snapshot fund address.");
  return { blockNumber: value.blockNumber, blockHash: value.blockHash.toLowerCase(), timestamp: new Date(value.timestamp).toISOString(), fundAddresses };
}

function participants(rows, label) {
  if (!Array.isArray(rows)) throw new Error(`${label} must be an array.`);
  const seen = new Set();
  return rows.map(row => {
    object(row, label);
    const account = address(row.address, label);
    if (seen.has(account)) throw new Error(`Duplicate ${label} address: ${account}`);
    seen.add(account);
    return { address: account, proposedRaw: parseRewardDecimal(row.amount, `${label} amount`) };
  }).sort((a, b) => a.address.localeCompare(b.address));
}

function treeEntries(entitlements, chainId, distributor) {
  const values = [...entitlements].sort(([a], [b]) => a.localeCompare(b))
    .map(([account, amount]) => [chainId, distributor, account, amount.toString()]);
  if (!values.length) return { root: ZERO_ROOT, entries: [] };
  const tree = StandardMerkleTree.of(values, LEAF_TYPES);
  const entries = [...tree.entries()].map(([index, value]) => ({
    address: value[2], cumulativeEntitlement: formatRewardDecimal(BigInt(value[3])),
    cumulativeEntitlementRaw: value[3], leaf: tree.leafHash(value), proof: tree.getProof(index),
  })).sort((a, b) => a.address.localeCompare(b.address));
  return { root: tree.root, entries };
}

function previousEntitlements(previous, week, chainId, distributor, currentSnapshot) {
  if (week === 1) {
    if (previous !== undefined) throw new Error("Week one must not have a previous artifact.");
    return { entitlements: new Map(), depositors: 0n, creators: 0n };
  }
  object(previous, "Previous artifact");
  if (previous.schema !== SCHEMA || previous.chainId !== chainId || previous.distributor !== distributor
    || previous.token !== "OTF" || previous.tokenDecimals !== 18) throw new Error("Previous artifact schema, chain, or distributor mismatch.");
  if (previous.week !== week - 1) throw new Error("Weeks must be consecutive; repeated and out-of-order weeks are not allowed.");
  const priorSnapshot = snapshot(previous.snapshot);
  if (BigInt(currentSnapshot.blockNumber) <= BigInt(priorSnapshot.blockNumber)
    || Date.parse(currentSnapshot.timestamp) <= Date.parse(priorSnapshot.timestamp)) throw new Error("Snapshot must advance beyond the previous week.");
  if (!Array.isArray(previous.entries)) throw new Error("Previous artifact entries are required.");
  const entitlements = new Map();
  for (const entry of previous.entries) {
    object(entry, "Previous entry");
    const account = address(entry.address, "previous participant");
    const amount = rawAmount(entry.cumulativeEntitlementRaw, "previous entitlement");
    if (entitlements.has(account)) throw new Error("Duplicate previous participant.");
    if (amount === 0n || parseRewardDecimal(entry.cumulativeEntitlement) !== amount) throw new Error("Inconsistent previous entitlement.");
    entitlements.set(account, amount);
  }
  if (treeEntries(entitlements, chainId, distributor).root !== previous.root) throw new Error("Previous artifact root does not match its entitlements.");
  object(previous.cumulativeAllocatedRaw, "Previous cumulative totals");
  const depositors = rawAmount(previous.cumulativeAllocatedRaw.depositors, "previous depositors");
  const creators = rawAmount(previous.cumulativeAllocatedRaw.creators, "previous creators");
  if (depositors + creators !== sum([...entitlements.values()])
    || rawAmount(previous.cumulativeAllocatedRaw.total, "previous total") !== depositors + creators) throw new Error("Previous cumulative totals do not match entitlements.");
  const pastBudgets = Array.from({ length: week - 1 }, (_, index) => weeklyEmissionBucketsRaw(index + 1));
  if (depositors > sum(pastBudgets.map(row => row.depositors)) || creators > sum(pastBudgets.map(row => row.creators))) {
    throw new Error("Previous cumulative allocations exceed scheduled budgets.");
  }
  return { entitlements, depositors, creators };
}

export function buildRewardsArtifact(input, chainId, distributor, previous) {
  object(input, "Weekly JSON input");
  if (!/^\d+$/u.test(String(chainId)) || BigInt(chainId) <= 0n || BigInt(chainId) > UINT256_MAX) throw new Error("Chain ID must be a positive uint256 integer.");
  chainId = BigInt(chainId).toString();
  distributor = address(distributor, "distributor");
  const week = input.week;
  if (!Number.isInteger(week) || week < 1 || week > OTF_INCENTIVE_WEEKS) throw new Error("Week must be between 1 and 208.");
  const otfPriceUsdRaw = parseRewardDecimal(input.otfPriceUsd, "chosen OTF USD price");
  if (otfPriceUsdRaw === 0n) throw new Error("Chosen OTF USD price must be positive.");
  const currentSnapshot = snapshot(input.snapshot);
  if (!Array.isArray(input.funds)) throw new Error("Weekly funds must be an array.");
  const seen = new Set();
  const funds = input.funds.map(fund => {
    object(fund, "Fund");
    const fundAddress = address(fund.address, "fund");
    if (seen.has(fundAddress)) throw new Error(`Duplicate fund: ${fundAddress}`);
    seen.add(fundAddress);
    const accountedRaw = parseRewardDecimal(fund.accountedOtf, "accounted OTF balance");
    const weightCap = BigInt(OTF_REWARD_WEIGHT_CAP) * REWARD_SCALE;
    return {
      address: fundAddress, accountedRaw, weightRaw: accountedRaw < weightCap ? accountedRaw : weightCap,
      navUsdRaw: parseRewardDecimal(fund.navUsd, "fund snapshot NAV"),
      depositors: participants(fund.depositors, "depositor"), creators: participants(fund.creators, "creator"),
    };
  }).sort((a, b) => a.address.localeCompare(b.address));
  if (funds.length !== currentSnapshot.fundAddresses.length
    || funds.some((fund, index) => fund.address !== currentSnapshot.fundAddresses[index])) throw new Error("Funds must exactly match the complete snapshot fund roster.");

  const prior = previousEntitlements(previous, week, chainId, distributor, currentSnapshot);
  const budgets = weeklyEmissionBucketsRaw(week);
  const totalWeightRaw = sum(funds.map(fund => fund.weightRaw));
  let allocatedDepositors = 0n, allocatedCreators = 0n;
  const addEntitlement = (account, increment) => {
    if (increment === 0n) return;
    const amount = (prior.entitlements.get(account) ?? 0n) + increment;
    if (amount > UINT256_MAX) throw new Error("Cumulative entitlement exceeds uint256.");
    prior.entitlements.set(account, amount);
  };
  const allocations = funds.map(fund => {
    const allowance = cappedDepositorAllocation({ weeklyDepositorEmissionRaw: budgets.depositors, fundNavUsdRaw: fund.navUsdRaw,
      otfPriceUsdRaw, fundWeightRaw: fund.weightRaw, totalWeightRaw });
    const proposedDepositors = sum(fund.depositors.map(row => row.proposedRaw));
    const depositorTarget = proposedDepositors < allowance.allocatedRaw ? proposedDepositors : allowance.allocatedRaw;
    const creatorAllowance = totalWeightRaw === 0n ? 0n : budgets.creators * fund.weightRaw / totalWeightRaw;
    const proposedCreators = sum(fund.creators.map(row => row.proposedRaw));
    if (proposedCreators > creatorAllowance) throw new Error(`Creator rewards exceed proportional allocation for ${fund.address}.`);
    const depositors = fund.depositors.map(row => {
      const allocated = proposedDepositors === 0n ? 0n : row.proposedRaw * depositorTarget / proposedDepositors;
      allocatedDepositors += allocated;
      addEntitlement(row.address, allocated);
      return { address: row.address, proposedRaw: String(row.proposedRaw), allocatedRaw: String(allocated) };
    });
    const creators = fund.creators.map(row => {
      allocatedCreators += row.proposedRaw;
      addEntitlement(row.address, row.proposedRaw);
      return { address: row.address, proposedRaw: String(row.proposedRaw), allocatedRaw: String(row.proposedRaw) };
    });
    return {
      address: fund.address, accountedOtf: formatRewardDecimal(fund.accountedRaw), navUsd: formatRewardDecimal(fund.navUsdRaw),
      weightRaw: String(fund.weightRaw), proportionalDepositorRaw: String(allowance.proportionalRaw),
      depositorLimitRaw: String(allowance.allocatedRaw), apyCapped: allowance.capped,
      proportionalCreatorRaw: String(creatorAllowance), depositors, creators,
    };
  });

  return {
    schema: SCHEMA, chainId, distributor, token: "OTF", tokenDecimals: 18, week,
    previousRoot: previous?.root ?? null,
    snapshot: currentSnapshot, otfPriceUsd: input.otfPriceUsd, apyCapPercent: OTF_REWARDS_APY_CAP_PERCENT,
    totalWeightRaw: String(totalWeightRaw),
    budgetRaw: rawTotals(budgets.depositors, budgets.creators),
    allocatedRaw: rawTotals(allocatedDepositors, allocatedCreators),
    unallocatedRaw: rawTotals(budgets.depositors - allocatedDepositors, budgets.creators - allocatedCreators),
    cumulativeAllocatedRaw: rawTotals(prior.depositors + allocatedDepositors, prior.creators + allocatedCreators),
    funds: allocations, ...treeEntries(prior.entitlements, chainId, distributor),
  };
}

function argument(name, optional = false) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1 && optional) return undefined;
  if (index === -1 || !process.argv[index + 1] || process.argv[index + 1].startsWith("--")) throw new Error(`Missing --${name}.`);
  return process.argv[index + 1];
}

function main() {
  const inputPath = resolve(argument("input"));
  if (extname(inputPath).toLowerCase() !== ".json") throw new Error("Weekly rewards input must be JSON; cumulative-only JSON/CSV is no longer supported.");
  const outputPath = resolve(argument("output"));
  const previousPath = argument("previous", true);
  const artifact = buildRewardsArtifact(
    JSON.parse(readFileSync(inputPath, "utf8")), argument("chain-id"), argument("distributor"),
    previousPath ? JSON.parse(readFileSync(resolve(previousPath), "utf8")) : undefined,
  );
  // Preserve the input and publication history, including on accidental reruns.
  writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, { flag: "wx" });
  console.log(`Week ${artifact.week} Merkle root ${artifact.root} written to ${outputPath}`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main();
