import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { testnetOtfSeedConfiguration } from "./testnet-otf-seeds.mjs";

const catalog = JSON.parse(readFileSync(
  new URL("../../app/src/config/robinhood-testnet-assets.json", import.meta.url),
  "utf8",
));
const beneficiary = "0xc340D7085E321B82CF550904310EE44bae9e4CD2";

test("defines three distinct testnet OTFs with varied fees and baskets", () => {
  const seeds = testnetOtfSeedConfiguration(catalog, beneficiary);

  assert.equal(seeds.length, 3);
  assert.equal(new Set(seeds.map((seed) => seed.name)).size, 3);
  assert.equal(new Set(seeds.map((seed) => seed.symbol)).size, 3);
  assert.equal(new Set(seeds.map((seed) => seed.fundThesis)).size, 3);
  assert.deepEqual(
    seeds.map((seed) => [
      seed.annualCreatorExpenseRatioBps,
      seed.mintFeeBps,
      seed.redeemFeeBps,
    ]),
    [[0, 0, 0], [100, 25, 10], [250, 100, 50]],
  );
  assert.deepEqual(seeds.map((seed) => seed.constituents.length), [3, 3, 5]);
  for (const seed of seeds) {
    assert.equal(seed.expenseBeneficiary, beneficiary);
    assert.equal(seed.bootstrapBasketUnitsPerOTF.length, seed.constituents.length);
    assert(seed.bootstrapBasketUnitsPerOTF.every((unit) => unit === 10n ** 17n));
  }
});

test("rejects a catalog that is missing a seeded constituent", () => {
  assert.throws(
    () => testnetOtfSeedConfiguration({ fundAssets: [] }, beneficiary),
    /Missing testnet OTF seed constituent amzn/,
  );
});

test("the testnet deployment creates every configured seed", () => {
  const deploymentSource = readFileSync(
    new URL("../deploy-robinhood-testnet.mjs", import.meta.url),
    "utf8",
  );

  assert.match(deploymentSource, /testnetOtfSeedConfiguration\(assetCatalog, protocolMultisig\)/u);
  assert.match(deploymentSource, /"createVault"/u);
});
