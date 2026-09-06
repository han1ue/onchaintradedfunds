import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { testnetOtfSeedConfiguration, testnetSeedMarketSnapshot } from "./testnet-otf-seeds.mjs";

const catalog = JSON.parse(readFileSync(
  new URL("../../app/src/config/robinhood-testnet-assets.json", import.meta.url),
  "utf8",
));
const beneficiary = "0xc340D7085E321B82CF550904310EE44bae9e4CD2";
const wad = 10n ** 18n;
const snapshot = {
  assets: catalog.fundAssets.map((asset, index) => ({
    id: asset.id, priceUsd: String(100 + index * 25), marketCapUsd: String(1_000_000_000_000 / (index + 1)),
  })),
};
const otfToken = { address: "0x0000000000000000000000000000000000000001", priceUsdWad: "52500000000000" };
const configuration = (assets = catalog, market = snapshot, token = otfToken) =>
  testnetOtfSeedConfiguration(assets, beneficiary, market, token);

test("defines four distinct testnet OTFs with varied fees and baskets", () => {
  const seeds = configuration();

  assert.equal(seeds.length, 4);
  assert.equal(new Set(seeds.map((seed) => seed.name)).size, 4);
  assert.equal(new Set(seeds.map((seed) => seed.symbol)).size, 4);
  assert.equal(new Set(seeds.map((seed) => seed.fundThesis)).size, 4);
  assert.deepEqual(
    seeds.map((seed) => [
      seed.annualCreatorExpenseRatioBps,
      seed.mintFeeBps,
      seed.redeemFeeBps,
    ]),
    [[0, 0, 0], [100, 25, 10], [250, 100, 50], [0, 0, 0]],
  );
  assert.deepEqual(seeds.map((seed) => seed.constituents.length), [3, 4, 6, 5]);
  for (const seed of seeds) {
    assert(seed.name.endsWith(" OTF"));
    assert(Buffer.byteLength(seed.name, "utf8") <= 50);
    assert.match(seed.name.slice(0, -4), /[A-Za-z0-9]/u);
    assert(seed.symbol.length >= 1 && seed.symbol.length <= 8);
    assert.doesNotMatch(seed.symbol, /[^A-Za-z0-9]/u);
    assert.equal(seed.expenseBeneficiary, beneficiary);
    assert.equal(seed.bootstrapBasketUnitsPerOTF.length, seed.constituents.length);
    assert(seed.bootstrapBasketUnitsPerOTF.every((unit) => unit > 0n));
  }
});

test("MCAP5 value weights follow market caps, including mixed token decimals", () => {
  const assets = structuredClone(catalog);
  assets.fundAssets[0].decimals = 6;
  const seed = configuration(assets).find((seed) => seed.symbol === "MCAP5");
  const values = seed.constituents.map((address, index) => {
    const asset = assets.fundAssets.find((asset) => asset.address === address);
    const market = snapshot.assets.find((market) => market.id === asset.id);
    return Number(seed.bootstrapBasketUnitsPerOTF[index]) / 10 ** asset.decimals * Number(market.priceUsd);
  });
  const totalValue = values.reduce((sum, value) => sum + value, 0);
  const totalCap = snapshot.assets.reduce((sum, asset) => sum + Number(asset.marketCapUsd), 0);
  assert(Math.abs(totalValue - 100) < 0.001);
  values.forEach((value, index) => {
    const difference = value / totalValue - Number(snapshot.assets[index].marketCapUsd) / totalCap;
    assert(Math.abs(difference) < 0.0001, "must satisfy the app's one-basis-point tolerance");
  });
});

test("exactly AI Stack and Frontier Five allocate 10% of initial value to the deployed OTF", () => {
  const seeds = configuration().filter((seed) => seed.constituents.includes(otfToken.address));
  assert.deepEqual(seeds.map((seed) => seed.symbol), ["AISTK", "FIVE"]);
  for (const seed of seeds) {
    const values = seed.constituents.map((address, index) => {
      const asset = catalog.fundAssets.find((asset) => asset.address === address);
      const price = asset
        ? BigInt(snapshot.assets.find((market) => market.id === asset.id).priceUsd) * wad
        : BigInt(otfToken.priceUsdWad);
      return seed.bootstrapBasketUnitsPerOTF[index] * price / wad;
    });
    const weight = values.at(-1) * wad / values.reduce((sum, value) => sum + value, 0n);
    assert(weight >= wad / 10n - 10n && weight <= wad / 10n + 10n);
    // OTF's 1B total supply has a tiny cap relative to the seeded equities.
    const totalStockCap = seed.constituents.slice(0, -1).reduce((sum, address) => {
      const asset = catalog.fundAssets.find((asset) => asset.address === address);
      return sum + Number(snapshot.assets.find((market) => market.id === asset.id).marketCapUsd);
    }, 0);
    const otfCap = Number(otfToken.priceUsdWad) / 1e18 * 1e9;
    assert(Math.abs(Number(weight) / 1e18 - otfCap / (totalStockCap + otfCap)) > 0.0001);
  }
});

test("rejects missing prices, caps, invalid token and zero quantities", () => {
  for (const field of ["priceUsd", "marketCapUsd"]) {
    for (const value of [undefined, "0", "-1", "NaN"]) {
      const market = structuredClone(snapshot);
      market.assets[0][field] = value;
      assert.throws(() => configuration(catalog, market), /seed USD|Seed USD/);
    }
  }
  assert.throws(() => configuration(catalog, snapshot, {}), /OTF token address/);
  assert.throws(() => configuration(catalog, snapshot, { ...otfToken, priceUsdWad: "0" }), /price must be positive/);
  const assets = structuredClone(catalog);
  assets.fundAssets[0].decimals = 0;
  assert.throws(() => configuration(assets), /rounds to zero/);
});

test("loads a validated Yahoo snapshot, preferring trailing caps with quarterly fallback", async () => {
  const assets = { fundAssets: catalog.fundAssets.slice(0, 2) };
  const result = await testnetSeedMarketSnapshot(assets, async (url) => ({
    ok: true,
    json: async () => url.includes("/chart/")
      ? { chart: { result: [{ meta: { regularMarketPrice: 123.45 } }] } }
      : { timeseries: { result: [
        { meta: { type: ["quarterlyMarketCap"] }, quarterlyMarketCap: [{ reportedValue: { raw: 1000 } }] },
        { meta: { type: ["trailingMarketCap"] }, trailingMarketCap: url.includes("TSLA")
          ? [{ reportedValue: { raw: 2000 } }, { reportedValue: { raw: null } }] : [] },
      ] } },
  }));
  assert.deepEqual(result.assets.map((asset) => [asset.priceUsd, asset.marketCapUsd]), [["123.45", "2000"], ["123.45", "1000"]]);
  assert(Number.isFinite(Date.parse(result.capturedAt)));
  await assert.rejects(() => testnetSeedMarketSnapshot(assets, async () => ({ ok: false, status: 503 })), /503/);
  await assert.rejects(() => testnetSeedMarketSnapshot(assets, async () => ({ ok: true, json: async () => ({}) })), /Missing or invalid/);
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

  assert.match(deploymentSource, /testnetOtfSeedConfiguration\(\s*assetCatalog, protocolMultisig, seedMarketSnapshot, seedMarketSnapshot.otfToken,/u);
  assert.match(deploymentSource, /"createVault"/u);
});
