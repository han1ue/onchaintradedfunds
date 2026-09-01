import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const config = JSON.parse(
  readFileSync(resolve(root, "app", "src", "config", "robinhood-mainnet.json"), "utf8"),
);
const oracle = config.externalContracts?.ethUsdOracle;
const rpcUrl = process.env.RH_MAINNET_RPC_URL?.trim()
  || "https://rpc.mainnet.chain.robinhood.com";
const maxAge = Number(process.env.ORACLE_MAX_AGE_SECONDS);

if (typeof oracle !== "string" || !/^0x[0-9a-fA-F]{40}$/u.test(oracle)) {
  throw new Error("robinhood-mainnet.json does not contain a valid ETH/USD oracle address");
}
if (!Number.isSafeInteger(maxAge) || maxAge <= 0) {
  throw new Error("ORACLE_MAX_AGE_SECONDS must be a positive integer");
}

let requestId = 0;
async function rpc(method, params) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, params }),
  });
  if (!response.ok) throw new Error(`RPC ${method} returned HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(`RPC ${method} failed: ${payload.error.message}`);
  return payload.result;
}

function word(data, index) {
  const start = 2 + index * 64;
  const value = data.slice(start, start + 64);
  if (value.length !== 64) throw new Error("Oracle returned malformed ABI data");
  return BigInt(`0x${value}`);
}

function signed(value) {
  return value >= 1n << 255n ? value - (1n << 256n) : value;
}

function abiString(data) {
  const encoded = Buffer.from(data.slice(2), "hex");
  const offset = Number(word(data, 0));
  if (!Number.isSafeInteger(offset) || offset + 32 > encoded.length) {
    throw new Error("Oracle returned a malformed description offset");
  }
  const length = Number(BigInt(`0x${encoded.subarray(offset, offset + 32).toString("hex")}`));
  if (!Number.isSafeInteger(length) || offset + 32 + length > encoded.length) {
    throw new Error("Oracle returned a malformed description length");
  }
  return encoded.subarray(offset + 32, offset + 32 + length).toString("utf8");
}

const [chainIdHex, code, decimalsData, descriptionData, roundData] = await Promise.all([
  rpc("eth_chainId", []),
  rpc("eth_getCode", [oracle, "latest"]),
  rpc("eth_call", [{ to: oracle, data: "0x313ce567" }, "latest"]),
  rpc("eth_call", [{ to: oracle, data: "0x7284e416" }, "latest"]),
  rpc("eth_call", [{ to: oracle, data: "0xfeaf968c" }, "latest"]),
]);

const chainId = Number(BigInt(chainIdHex));
const decimals = Number(word(decimalsData, 0));
const description = abiString(descriptionData);
const answer = signed(word(roundData, 1));
const updatedAt = Number(word(roundData, 3));
const now = Math.floor(Date.now() / 1_000);

if (chainId !== 4663) throw new Error(`Expected Robinhood mainnet chain ID 4663, received ${chainId}`);
if (typeof code !== "string" || code === "0x") throw new Error("ETH/USD oracle has no deployed code");
if (description !== "ETH / USD") throw new Error(`Unexpected oracle description: ${description}`);
if (decimals !== 8) throw new Error(`Expected 8 oracle decimals, received ${decimals}`);
if (answer <= 0n) throw new Error("ETH/USD oracle answer is not positive");
if (!Number.isSafeInteger(updatedAt) || updatedAt <= 0 || updatedAt > now) {
  throw new Error("ETH/USD oracle update timestamp is invalid or in the future");
}
if (now - updatedAt > maxAge) {
  throw new Error(`ETH/USD oracle is stale by ${now - updatedAt}s; maximum is ${maxAge}s`);
}

console.log(JSON.stringify({
  chainId,
  oracle,
  description,
  decimals,
  answer: answer.toString(),
  updatedAt,
  ageSeconds: now - updatedAt,
  maxAgeSeconds: maxAge,
}, null, 2));
