import test from "node:test";
import assert from "node:assert/strict";
import { appOwnedIntegrationConfiguration } from "./deployment-config.mjs";

const appConfiguration = {
  externalLiquidity: {
    venue: "Synthra",
    baseUrl: "https://app.synthra.org/",
  },
  quoteService: { endpoint: null },
  creation: { assetDataEndpoint: "https://launch.onchaintradedfunds.com/api/v1/assets" },
};

test("preserves validated app-owned deployment integrations", () => {
  assert.deepEqual(appOwnedIntegrationConfiguration(appConfiguration), appConfiguration);
});

test("accepts a disabled quote service and rejects unsafe integration URLs", () => {
  assert.deepEqual(appOwnedIntegrationConfiguration(appConfiguration).quoteService, { endpoint: null });
  assert.throws(
    () => appOwnedIntegrationConfiguration({
      ...appConfiguration,
      quoteService: { endpoint: "http://quotes.example" },
    }),
    /quoteService\.endpoint must be null or an HTTPS URL/,
  );
  assert.throws(
    () => appOwnedIntegrationConfiguration({
      ...appConfiguration,
      externalLiquidity: { ...appConfiguration.externalLiquidity, baseUrl: "http://app.synthra.org/" },
    }),
    /externalLiquidity\.baseUrl must be an HTTPS URL/,
  );
  assert.throws(
    () => appOwnedIntegrationConfiguration({
      ...appConfiguration,
      creation: { assetDataEndpoint: "http://launch.example/api/v1/assets" },
    }),
    /creation\.assetDataEndpoint must be an HTTPS URL/,
  );
});

test("rejects missing integration sections instead of silently erasing them", () => {
  assert.throws(() => appOwnedIntegrationConfiguration({ quoteService: { endpoint: null } }), /externalLiquidity must be an object/);
  assert.throws(() => appOwnedIntegrationConfiguration({ externalLiquidity: appConfiguration.externalLiquidity }), /quoteService must be an object/);
  assert.throws(
    () => appOwnedIntegrationConfiguration({
      externalLiquidity: appConfiguration.externalLiquidity,
      quoteService: appConfiguration.quoteService,
    }),
    /creation must be an object/,
  );
});
