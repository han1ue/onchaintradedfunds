import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const require = createRequire(resolve(root, "app", "package.json"));

function loadViem() {
  try {
    return require("viem");
  } catch (error) {
    // A pnpm workspace can be partially installed while running offline. Keep the fixture
    // self-test usable when the package is present in pnpm's content-addressed workspace.
    const store = resolve(root, "node_modules", ".pnpm");
    const candidate = existsSync(store)
      ? readdirSync(store).find((name) => name.startsWith("viem@"))
      : undefined;
    if (candidate) return require(resolve(store, candidate, "node_modules", "viem"));
    throw error;
  }
}

const viem = loadViem();
const { getAddress, hashTypedData, isAddress } = viem;

const MAX_CONSTITUENTS = 20;
const MAX_CONSTITUENT_DECIMALS = 36n;
const UINT64_MAX = (1n << 64n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const allowedFields = new Set([
  "chainId",
  "factory",
  "creator",
  "constituents",
  "tokenDecimals",
  "marketCapsUsdWad",
  "unitPricesUsdWad",
  "snapshotTime",
  "expiry",
  "calculationVersion",
  "nonce",
]);

const types = {
  FormationSnapshot: [
    { name: "chainId", type: "uint256" },
    { name: "factory", type: "address" },
    { name: "creator", type: "address" },
    { name: "constituents", type: "address[]" },
    { name: "tokenDecimals", type: "uint8[]" },
    { name: "marketCapsUsdWad", type: "uint256[]" },
    { name: "unitPricesUsdWad", type: "uint256[]" },
    { name: "snapshotTime", type: "uint64" },
    { name: "expiry", type: "uint64" },
    { name: "calculationVersion", type: "uint32" },
    { name: "nonce", type: "uint256" },
  ],
};

function fail(message) {
  throw new Error(`Invalid formation snapshot: ${message}`);
}

export function uint(value, field, max = UINT256_MAX) {
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0)) {
    fail(`${field} must be a non-negative safe integer`);
  }
  if ((typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint")
      || (typeof value === "string" && !/^\d+$/u.test(value))) {
    fail(`${field} must be a non-negative integer`);
  }
  let parsed;
  try {
    parsed = BigInt(value);
  } catch {
    fail(`${field} must be a non-negative integer`);
  }
  if (parsed < 0n || parsed > max) fail(`${field} is outside its Solidity integer range`);
  return parsed;
}

function address(value, field) {
  if (typeof value !== "string" || !isAddress(value)) fail(`${field} must be an address`);
  return getAddress(value);
}

export function validate(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("fixture must be a JSON object");
  for (const key of Object.keys(raw)) {
    if (!allowedFields.has(key)) fail(`unexpected field ${key}; metadata and fee terms are not signed here`);
  }

  const chainId = uint(raw.chainId, "chainId");
  const factory = address(raw.factory, "factory");
  const creator = address(raw.creator, "creator");
  if (factory.toLowerCase() === ZERO_ADDRESS) fail("factory must be nonzero");
  if (creator.toLowerCase() === ZERO_ADDRESS) fail("creator must be nonzero");
  if (!Array.isArray(raw.constituents) || raw.constituents.length === 0
      || raw.constituents.length > MAX_CONSTITUENTS) {
    fail(`constituents must contain 1-${MAX_CONSTITUENTS} addresses`);
  }
  if (!Array.isArray(raw.marketCapsUsdWad) || raw.marketCapsUsdWad.length !== raw.constituents.length) {
    fail("marketCapsUsdWad must match constituents length");
  }
  if (!Array.isArray(raw.tokenDecimals) || raw.tokenDecimals.length !== raw.constituents.length) {
    fail("tokenDecimals must match constituents length");
  }
  if (!Array.isArray(raw.unitPricesUsdWad) || raw.unitPricesUsdWad.length !== raw.constituents.length) {
    fail("unitPricesUsdWad must match constituents length");
  }

  const constituents = raw.constituents.map((value, index) => address(value, `constituents[${index}]`));
  const seen = new Set();
  for (const constituent of constituents) {
    const key = constituent.toLowerCase();
    if (key === ZERO_ADDRESS) fail("constituents must be nonzero");
    if (seen.has(key)) fail(`duplicate constituent ${constituent}`);
    seen.add(key);
  }
  const tokenDecimals = raw.tokenDecimals.map((value, index) => {
    const parsed = uint(value, `tokenDecimals[${index}]`, (1n << 8n) - 1n);
    if (parsed > MAX_CONSTITUENT_DECIMALS) {
      fail(`tokenDecimals[${index}] exceeds ${MAX_CONSTITUENT_DECIMALS}`);
    }
    return parsed;
  });
  const marketCapsUsdWad = raw.marketCapsUsdWad.map((value, index) => {
    const parsed = uint(value, `marketCapsUsdWad[${index}]`);
    if (parsed === 0n) fail(`marketCapsUsdWad[${index}] must be positive`);
    return parsed;
  });
  const totalMarketCap = marketCapsUsdWad.reduce((total, marketCap) => {
    if (total > UINT256_MAX - marketCap) fail("market-cap sum overflows uint256");
    return total + marketCap;
  }, 0n);
  const unitPricesUsdWad = raw.unitPricesUsdWad.map((value, index) => {
    const parsed = uint(value, `unitPricesUsdWad[${index}]`);
    if (parsed === 0n) fail(`unitPricesUsdWad[${index}] must be positive`);
    return parsed;
  });
  const snapshotTime = uint(raw.snapshotTime, "snapshotTime", UINT64_MAX);
  const expiry = uint(raw.expiry, "expiry", UINT64_MAX);
  if (expiry <= snapshotTime) fail("expiry must be later than snapshotTime");
  const calculationVersion = uint(raw.calculationVersion, "calculationVersion", (1n << 32n) - 1n);
  if (calculationVersion !== 1n) fail("calculationVersion must be 1");
  const nonce = uint(raw.nonce, "nonce");

  const relativeQuantities = marketCapsUsdWad.map((marketCap, index) => {
    const weightWad = marketCap * 10n ** 18n / totalMarketCap;
    const quantity = weightWad * 10n ** tokenDecimals[index] / unitPricesUsdWad[index];
    if (quantity === 0n) fail(`derived relative quantity[${index}] is zero`);
    if (quantity > UINT256_MAX) fail(`derived relative quantity[${index}] overflows uint256`);
    return quantity;
  });

  const snapshot = {
    chainId,
    factory,
    creator,
    constituents,
    tokenDecimals,
    marketCapsUsdWad,
    unitPricesUsdWad,
    snapshotTime,
    expiry,
    calculationVersion,
    nonce,
  };
  return { snapshot, relativeQuantities };
}

function typedPayload(snapshot) {
  return {
    domain: {
      name: "OTFFactory",
      version: "1",
      chainId: snapshot.chainId,
      verifyingContract: snapshot.factory,
    },
    types,
    primaryType: "FormationSnapshot",
    message: snapshot,
  };
}

function json(value) {
  return JSON.stringify(value, (_key, current) => (
    typeof current === "bigint" ? current.toString() : current
  ), 2);
}

function readFixture(path) {
  if (!existsSync(path)) throw new Error(`Fixture not found: ${path}`);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Could not parse fixture ${path}: ${error.message}`);
  }
}

function arg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  if (process.argv.includes("--self-test")) {
    const fixturePath = resolve(root, "scripts", "fixtures", "formation-snapshot.json");
    const { snapshot, relativeQuantities } = validate(readFixture(fixturePath));
    const digest = hashTypedData(typedPayload(snapshot));
    // Vector generated from the exact Solidity FormationSnapshot type and array encoding.
    const expected = "0x977620fbecb73fae3020843ffe39350e1f5c2bc5e93f5865c9215ff99c75b7b0";
    if (digest !== expected) throw new Error(`formation vector mismatch: ${digest}`);
    if (relativeQuantities[0] !== 375_000_000_000_000_000n || relativeQuantities[1] !== 500_000n) {
      throw new Error(`formation quantity vector mismatch: ${relativeQuantities.join(",")}`);
    }
    console.log(`Formation snapshot self-test passed: ${digest}`);
    return;
  }

  const fixturePath = arg("--fixture") ?? resolve(root, "scripts", "fixtures", "formation-snapshot.json");
  if (process.argv.includes("--sign-private-key")) {
    throw new Error(
      "Private-key signing is intentionally unsupported; send the emitted typed payload to the configured external authority workflow.",
    );
  }
  const { snapshot, relativeQuantities } = validate(readFixture(resolve(fixturePath)));
  const payload = typedPayload(snapshot);
  const digest = hashTypedData(payload);
  const output = { digest, relativeQuantities, typedPayload: payload };
  process.stdout.write(`${json(output)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
