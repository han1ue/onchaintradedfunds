import { readFileSync, writeFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const AMOUNT = /^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/u;
const LEAF_TYPES = ["uint256", "address", "address", "uint256"];

function parseAmount(value) {
  if (typeof value !== "string" || !AMOUNT.test(value)) {
    throw new Error(`Malformed cumulative entitlement: ${String(value)}`);
  }
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, "0"));
}

function rowsFromJson(text) {
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error("JSON input must be an array of allocation rows.");
  return parsed;
}

function rowsFromCsv(text) {
  const lines = text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];
  const header = lines[0].split(",").map((cell) => cell.trim());
  if (header.length !== 2 || header[0] !== "address" || header[1] !== "cumulativeEntitlement") {
    throw new Error("CSV header must be address,cumulativeEntitlement.");
  }
  return lines.slice(1).map((line, index) => {
    const cells = line.split(",").map((cell) => cell.trim());
    if (cells.length !== 2) throw new Error(`Malformed CSV row ${index + 2}.`);
    return { address: cells[0], cumulativeEntitlement: cells[1] };
  });
}

export function parseAllocations(text, extension) {
  const rows = extension.toLowerCase() === ".csv" ? rowsFromCsv(text) : rowsFromJson(text);
  if (!rows.length) throw new Error("At least one allocation is required.");
  const seen = new Set();
  return rows.map((row, index) => {
    if (row === null || typeof row !== "object" || Array.isArray(row)) {
      throw new Error(`Allocation row ${index + 1} must be an object.`);
    }
    const address = row.address;
    if (typeof address !== "string" || !ADDRESS.test(address)) {
      throw new Error(`Invalid address in allocation row ${index + 1}.`);
    }
    const normalized = address.toLowerCase();
    if (seen.has(normalized)) throw new Error(`Duplicate allocation address: ${address}`);
    seen.add(normalized);
    const raw = parseAmount(row.cumulativeEntitlement);
    return {
      address: normalized,
      cumulativeEntitlement: String(row.cumulativeEntitlement),
      cumulativeEntitlementRaw: raw,
    };
  }).sort((a, b) => a.address.localeCompare(b.address));
}

export function buildRewardsArtifact(allocations, chainId, distributor) {
  if (!/^\d+$/u.test(String(chainId)) || BigInt(chainId) <= 0n) {
    throw new Error("Chain ID must be a positive integer.");
  }
  if (typeof distributor !== "string" || !ADDRESS.test(distributor)) {
    throw new Error("Distributor must be a valid address.");
  }
  const normalizedDistributor = distributor.toLowerCase();
  const values = allocations.map((allocation) => [
    String(chainId),
    normalizedDistributor,
    allocation.address,
    allocation.cumulativeEntitlementRaw.toString(),
  ]);
  const tree = StandardMerkleTree.of(values, LEAF_TYPES);
  const byAddress = new Map(allocations.map((allocation) => [allocation.address, allocation]));
  const entries = [];
  for (const [index, value] of tree.entries()) {
    const allocation = byAddress.get(value[2].toLowerCase());
    entries.push({
      address: allocation.address,
      cumulativeEntitlement: allocation.cumulativeEntitlement,
      cumulativeEntitlementRaw: allocation.cumulativeEntitlementRaw.toString(),
      leaf: tree.leafHash(value),
      proof: tree.getProof(index),
    });
  }
  entries.sort((a, b) => a.address.localeCompare(b.address));
  return {
    schema: "otf-cumulative-rewards-v1",
    chainId: String(chainId),
    distributor: normalizedDistributor,
    token: "OTF",
    tokenDecimals: 18,
    root: tree.root,
    entries,
  };
}

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1 || !process.argv[index + 1]) throw new Error(`Missing --${name}.`);
  return process.argv[index + 1];
}

function main() {
  const inputPath = resolve(argument("input"));
  const outputPath = resolve(argument("output"));
  const allocations = parseAllocations(readFileSync(inputPath, "utf8"), extname(inputPath));
  const artifact = buildRewardsArtifact(
    allocations,
    argument("chain-id"),
    argument("distributor"),
  );
  writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(`Merkle root ${artifact.root} written to ${outputPath}`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main();
