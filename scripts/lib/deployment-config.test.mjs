import test from "node:test";
import assert from "node:assert/strict";
import {
  appOwnedIntegrationConfiguration,
  withAppOwnedIntegrationConfiguration,
} from "./deployment-config.mjs";

const appConfiguration = {
  externalLiquidity: {
    venue: "Synthra",
    baseUrl: "https://app.synthra.org/",
  },
  quoteService: { endpoint: null },
};

test("preserves validated app-owned integration configuration in a deployment manifest", () => {
  const deployment = withAppOwnedIntegrationConfiguration({ schemaVersion: 9, contracts: {} }, appConfiguration);

  assert.deepEqual(deployment, {
    schemaVersion: 9,
    contracts: {},
    externalLiquidity: { venue: "Synthra", baseUrl: "https://app.synthra.org/" },
    quoteService: { endpoint: null },
  });
});

test("accepts a disabled quote service and rejects non-HTTPS integrations", () => {
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
      externalLiquidity: { venue: "Synthra", baseUrl: "http://app.synthra.org/" },
    }),
    /externalLiquidity\.baseUrl must be an HTTPS URL/,
  );
});
