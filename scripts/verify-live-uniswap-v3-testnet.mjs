import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { verifyTestnetRoutingRuntime } from "./lib/testnet-routing.mjs";

const require = createRequire(new URL("../app/package.json", import.meta.url));
const { createPublicClient, http, parseAbi, decodeFunctionData, keccak256 } = require("viem");
const root = resolve(import.meta.dirname, "..");
const read = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const config = read("app/src/config/robinhood-testnet.json");
const catalog = read("app/src/config/robinhood-testnet-assets.json");
const seeds = read("deployments/robinhood-testnet-v3-liquidity.json");
const budget = read("scripts/fixtures/robinhood-testnet-v3-budget.json");
const journal = read("deployments/robinhood-testnet-v3-journal.json");
const client = createPublicClient({ transport: http(config.rpcUrl) });
await verifyTestnetRoutingRuntime(client, config, read("scripts/fixtures/robinhood-testnet-routing.json"));
const abi = (name) => read(`contracts/out/${name}.sol/${name}.json`).abi;
const erc20 = parseAbi(["function allowance(address,address) view returns (uint256)"]);
const poolAbi = parseAbi(["function factory() view returns (address)", "function token0() view returns (address)", "function token1() view returns (address)", "function fee() view returns (uint24)", "function liquidity() view returns (uint128)"]);
const npmAbi = read("node_modules/@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json").abi;
const contracts = {};
for (const [name, deployed] of Object.entries(config.contracts)) {
  const code = await client.getCode({ address: deployed.address });
  assert(code && code !== "0x", name);
  const hash = keccak256(code);
  if (deployed.runtimeCodehash) assert.equal(hash, deployed.runtimeCodehash, `${name} runtime`);
  contracts[name] = { address: deployed.address, runtimeCodehash: hash, transactionHash: deployed.transactionHash };
}
const launch = config.contracts.launchManager.address;
assert.equal(BigInt(launch) & 0x3fffn, 0x2840n);
assert.equal(await client.readContract({ address: launch, abi: abi("OTFLaunchManager"), functionName: "hookPermissionsValid" }), true);
for (const [functionName, expected] of Object.entries({ entryExitRouter: config.contracts.entryRouter.address, uniswapV3Factory: catalog.venue.factory, uniswapV3Router: catalog.venue.swapRouter02 })) {
  assert.equal((await client.readContract({ address: config.contracts.uniswapV3Adapter.address, abi: abi("UniswapV3Adapter"), functionName })).toLowerCase(), expected.toLowerCase());
}
const old = journal.transactions.find((entry) => entry.transactionHash === config.setupTransactions.revokePreviousV3Adapter.transactionHash);
const revoked = decodeFunctionData({ abi: abi("OTFEntryExitRouter"), data: old.data }).args[0];
assert.equal(await client.readContract({ address: old.to, abi: abi("OTFEntryExitRouter"), functionName: "isAdapterApproved", args: [revoked] }), false);
const pools = [];
for (const pool of catalog.pools) {
  const seed = seeds.pools.find((entry) => entry.id === pool.id);
  const tokens = [...catalog.quoteAssets, ...catalog.fundAssets];
  const ordered = [tokens.find((token) => token.id === pool.assetA).address, tokens.find((token) => token.id === pool.assetB).address].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1);
  for (const [functionName, expected] of Object.entries({ factory: catalog.venue.factory, token0: ordered[0], token1: ordered[1] })) {
    assert.equal((await client.readContract({ address: pool.address, abi: poolAbi, functionName })).toLowerCase(), expected.toLowerCase());
  }
  assert.equal(await client.readContract({ address: pool.address, abi: poolAbi, functionName: "fee" }), pool.fee);
  const liquidity = await client.readContract({ address: pool.address, abi: poolAbi, functionName: "liquidity" });
  assert(liquidity > 0n);
  assert.equal((await client.readContract({ address: catalog.venue.positionManager, abi: npmAbi, functionName: "ownerOf", args: [BigInt(seed.tokenId)] })).toLowerCase(), config.deployer.toLowerCase());
  const position = await client.readContract({ address: catalog.venue.positionManager, abi: npmAbi, functionName: "positions", args: [BigInt(seed.tokenId)] });
  assert.equal(position[7], BigInt(seed.mintedLiquidity));
  const assetIs0 = ordered[0].toLowerCase() === tokens.find((token) => token.id === pool.assetA).address.toLowerCase();
  const cap = budget.markets.find((entry) => entry.id === pool.id);
  assert(BigInt(assetIs0 ? seed.amount0 : seed.amount1) <= BigInt(cap.assetRaw));
  assert(BigInt(assetIs0 ? seed.amount1 : seed.amount0) <= BigInt(cap.quoteRaw));
  for (const token of ordered) assert.equal(await client.readContract({ address: token, abi: erc20, functionName: "allowance", args: [config.deployer, catalog.venue.positionManager] }), 0n);
  pools.push({ id: pool.id, address: pool.address, runtimeCodehash: keccak256(await client.getCode({ address: pool.address })), liquidity, tokenId: seed.tokenId, owner: config.deployer });
}
let seedGasSpend = 0n;
for (const transaction of seeds.transactions) {
  const receipt = await client.getTransactionReceipt({ hash: transaction.transactionHash });
  assert.equal(receipt.status, "success");
  seedGasSpend += receipt.gasUsed * receipt.effectiveGasPrice;
}
assert(seedGasSpend <= BigInt(budget.maxSeedGasSpendWei));
assert(BigInt(journal.gasSpend) <= BigInt(budget.maxDeploymentGasSpendWei));
const report = { chainId: 46630, checkedAt: new Date().toISOString(), result: "passed", contracts, pools,
  revokedAdapter: revoked, previousRouter: old.to, revocationTransactionHash: config.setupTransactions.revokePreviousV3Adapter.transactionHash,
  seedGasSpendWei: seedGasSpend, deploymentGasSpendWei: journal.gasSpend, totalGasSpendWei: seedGasSpend + BigInt(journal.gasSpend) };
writeFileSync(resolve(root, "deployments/robinhood-testnet-v3-verification.json"), JSON.stringify(report, (_key, value) => typeof value === "bigint" ? value.toString() : value, 2) + "\n");
console.log(`Verified ${Object.keys(contracts).length} live protocol runtimes, six owned positions, adapter revocation, allowance cleanup, and funding caps.`);
