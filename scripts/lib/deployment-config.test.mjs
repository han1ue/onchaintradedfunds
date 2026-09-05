import test from "node:test";
import assert from "node:assert/strict";
import { appOwnedIntegrationConfiguration } from "./deployment-config.mjs";

const appConfiguration = {
  externalLiquidity: {
    venue: "Uniswap V3",
    baseUrl: "https://app.onchaintradedfunds.com/liquidity",
  },
  creation: { assetDataEndpoint: "https://launch.onchaintradedfunds.com/api/assets" },
};

test("preserves validated app-owned deployment integrations", () => {
  assert.deepEqual(appOwnedIntegrationConfiguration(appConfiguration), appConfiguration);
});

test("rejects unsafe integration URLs", () => {
  assert.throws(
    () => appOwnedIntegrationConfiguration({
      ...appConfiguration,
      externalLiquidity: { ...appConfiguration.externalLiquidity, baseUrl: "http://app.onchaintradedfunds.com/liquidity" },
    }),
    /externalLiquidity\.baseUrl must be an HTTPS URL/,
  );
  assert.throws(
    () => appOwnedIntegrationConfiguration({
      ...appConfiguration,
      creation: { assetDataEndpoint: "http://launch.example/api/assets" },
    }),
    /creation\.assetDataEndpoint must be an HTTPS URL/,
  );
});

test("rejects missing integration sections instead of silently erasing them", () => {
  assert.throws(() => appOwnedIntegrationConfiguration({ creation: appConfiguration.creation }), /externalLiquidity must be an object/);
  assert.throws(
    () => appOwnedIntegrationConfiguration({
      externalLiquidity: appConfiguration.externalLiquidity,
    }),
    /creation must be an object/,
  );
});
