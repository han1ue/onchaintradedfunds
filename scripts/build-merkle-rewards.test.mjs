import assert from "node:assert/strict";
import test from "node:test";
import { buildRewardsArtifact, parseAllocations } from "./build-merkle-rewards.mjs";

const distributor = "0x00000000000000000000000000000000000000d1";

test("builds deterministic cumulative standard-tree proofs", () => {
  const input = JSON.stringify([
    { address: "0x00000000000000000000000000000000000000b2", cumulativeEntitlement: "2.5" },
    { address: "0x00000000000000000000000000000000000000A1", cumulativeEntitlement: "1" },
  ]);
  const allocations = parseAllocations(input, ".json");
  const first = buildRewardsArtifact(allocations, "46630", distributor);
  const second = buildRewardsArtifact(allocations, "46630", distributor);
  assert.deepEqual(first, second);
  assert.equal(first.entries[0].cumulativeEntitlementRaw, "1000000000000000000");
  assert.equal(first.entries[1].cumulativeEntitlementRaw, "2500000000000000000");
});

test("rejects duplicate, invalid, negative, and malformed allocations", () => {
  const address = "0x00000000000000000000000000000000000000A1";
  assert.throws(() => parseAllocations(JSON.stringify([
    { address, cumulativeEntitlement: "1" },
    { address: address.toLowerCase(), cumulativeEntitlement: "2" },
  ]), ".json"), /Duplicate/u);
  assert.throws(() => parseAllocations(JSON.stringify([
    { address: "0x123", cumulativeEntitlement: "1" },
  ]), ".json"), /Invalid address/u);
  for (const amount of ["-1", "1e18", "1.0000000000000000001", "", "1.", 1]) {
    assert.throws(() => parseAllocations(JSON.stringify([{ address, cumulativeEntitlement: amount }]), ".json"), /Malformed/u);
  }
});
