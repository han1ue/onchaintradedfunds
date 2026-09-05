import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(new URL("../app/package.json", import.meta.url));
const { createPublicClient, http, keccak256, parseAbiParameters, parseAbi,
  encodeAbiParameters, getCreate2Address, getAddress, formatUnits, zeroAddress, stringToHex } = require("viem");
const root = resolve(import.meta.dirname, "..");
const read = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const save = (path, value) => writeFileSync(resolve(root, path), JSON.stringify(value,
  (_key, item) => typeof item === "bigint" ? item.toString() : item, 2) + "\n");
const config = read("app/src/config/robinhood-testnet.json");
const catalog = read("app/src/config/robinhood-testnet-assets.json");
const client = createPublicClient({ transport: http(process.env.TESTNET_RPC_URL || config.rpcUrl) });
if (await client.getChainId() !== 46630) throw new Error("Only Robinhood testnet chain 46630 is allowed");
const block = await client.getBlock();
const factory = "0x09b6d850382787115969a2699f107f5a974c781b";
const weth9 = "0x0dd1df4fdd55808c9d530c9599bea5107f6b9b4e";
const npm = "0x15e98cf94a32c7fd23a36fabb4fee612277da47b";
const definitions = [
  ["uniswapV3Factory", factory, "@uniswap/v3-core", "UniswapV3Factory", []],
  ["uniswapV3PositionManager", npm, "@uniswap/v3-periphery", "NonfungiblePositionManager", [factory, weth9, zeroAddress]],
  ["uniswapV3QuoterV2", "0x3e3d78f0e8d0b0b227c2261f407b7cda97126b9a", "@uniswap/v3-periphery", "lens/QuoterV2", [factory, weth9]],
  ["uniswapV3SwapRouter02", "0xf4edb91d541dd1bde41cebbe72bf2d44492adca4", "@uniswap/swap-router-contracts", "SwapRouter02", [zeroAddress, factory, npm, weth9]],
];
const addressAbi = (name) => parseAbi([`function ${name}() view returns (address)`]);
const binding = async (address, name, expected) => {
  const actual = await client.readContract({ address, abi: addressAbi(name), functionName: name });
  if (actual.toLowerCase() !== expected.toLowerCase()) throw new Error(`${address}.${name} mismatch`);
  return actual;
};

// Published Hardhat artifacts zero their immutable PUSH32 operands. Every other byte,
// including metadata, must match. Only constructor-bound values (or factory self) may fill them.
function compareRuntime(artifact, actual, immutableValues) {
  const expected = Buffer.from(artifact.slice(2), "hex");
  const observed = Buffer.from(actual.slice(2), "hex");
  if (expected.length !== observed.length) throw new Error("Runtime length mismatch");
  const allowed = new Set(immutableValues.map((value) => value.slice(2).toLowerCase().padStart(64, "0")));
  const substitutions = [];
  for (let offset = 0; offset < expected.length;) {
    const opcode = expected[offset];
    if (opcode === 0x7f && expected.subarray(offset + 1, offset + 33).equals(Buffer.alloc(32))) {
      const word = observed.subarray(offset + 1, offset + 33).toString("hex");
      if (word !== "0".repeat(64)) {
        if (!allowed.has(word)) throw new Error(`Unknown immutable at byte ${offset + 1}`);
        observed.copy(expected, offset + 1, offset + 1, offset + 33);
        substitutions.push({ offset: offset + 1, value: `0x${word}` });
      }
    }
    offset += opcode >= 0x60 && opcode <= 0x7f ? opcode - 0x5f + 1 : 1;
  }
  if (!expected.equals(observed)) throw new Error("Runtime differs outside authenticated immutable operands");
  return substitutions;
}

mkdirSync(resolve(root, "test-results/v3-auth"), { recursive: true });
const dependencies = {};
for (const [name, address, pkg, contract, args] of definitions) {
  const artifactPath = `node_modules/${pkg}/artifacts/contracts/${contract}.sol/${contract.split("/").at(-1)}.json`;
  const artifact = read(artifactPath);
  const sourceUrl = `https://explorer.testnet.chain.robinhood.com/api/v2/smart-contracts/${address}`;
  const response = await fetch(sourceUrl);
  if (!response.ok) throw new Error(`Explorer returned ${response.status}`);
  const source = await response.json();
  const encodedArgs = args.length ? encodeAbiParameters(args.map(() => ({ type: "address" })), args).slice(2) : "";
  if (source.creation_bytecode.toLowerCase() !== (artifact.bytecode + encodedArgs).toLowerCase()) {
    throw new Error(`${name} creation bytecode/constructor arguments differ from ${pkg}`);
  }
  const runtime = await client.getCode({ address });
  if (!runtime || runtime === "0x" || runtime.toLowerCase() !== source.deployed_bytecode.toLowerCase()) {
    throw new Error(`${name} RPC/explorer runtime mismatch`);
  }
  const fixedImmutables = name === "uniswapV3PositionManager"
    ? [keccak256(stringToHex("Uniswap V3 Positions NFT-V1")), keccak256(stringToHex("1"))] : [];
  const immutableSubstitutions = compareRuntime(artifact.deployedBytecode, runtime, [address, ...args, ...fixedImmutables]);
  const bindings = {};
  if (name !== "uniswapV3Factory") {
    bindings.factory = await binding(address, "factory", factory);
    bindings.WETH9 = await binding(address, "WETH9", weth9);
  }
  if (name === "uniswapV3SwapRouter02") {
    bindings.positionManager = await binding(address, "positionManager", npm);
    bindings.factoryV2 = await binding(address, "factoryV2", zeroAddress);
  }
  dependencies[name] = { address: getAddress(address), codehash: keccak256(runtime), package: pkg,
    version: read(`node_modules/${pkg}/package.json`).version, artifactPath,
    creationCodehash: keccak256(artifact.bytecode), constructorArguments: args,
    immutableSubstitutions, bindings, sourceUrl, artifactCorrespondence: "exact creation and runtime with constructor immutables" };
  console.log(`${name}: exact published artifact, runtime ${dependencies[name].codehash}`);
}
const wethCode = await client.getCode({ address: weth9 });
if (!wethCode || wethCode === "0x") throw new Error("Periphery WETH9 has no bytecode");
dependencies.uniswapV3Weth9 = { address: getAddress(weth9), codehash: keccak256(wethCode),
  artifactCorrespondence: "Separate WETH dependency; not a Uniswap V3 package artifact. Not used for protocol wrapping or pool funding." };

const poolArtifact = read("node_modules/@uniswap/v3-core/artifacts/contracts/UniswapV3Pool.sol/UniswapV3Pool.json");
const poolInitCodehash = keccak256(poolArtifact.bytecode);
const erc20Abi = parseAbi(["function decimals() view returns (uint8)", "function balanceOf(address) view returns (uint256)"]);
const factoryAbi = parseAbi(["function getPool(address,address,uint24) view returns (address)", "function feeAmountTickSpacing(uint24) view returns (int24)"]);
const poolAbi = parseAbi(["function token0() view returns (address)", "function token1() view returns (address)", "function fee() view returns (uint24)", "function factory() view returns (address)", "function liquidity() view returns (uint128)", "function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)"]);
const assets = [...catalog.quoteAssets, ...catalog.fundAssets];
const balances = {};
for (const asset of assets) {
  const decimals = await client.readContract({ address: asset.address, abi: erc20Abi, functionName: "decimals" });
  if (decimals !== asset.decimals) throw new Error(`${asset.symbol} decimals mismatch`);
  const balance = await client.readContract({ address: asset.address, abi: erc20Abi, functionName: "balanceOf", args: [config.deployer] });
  balances[asset.symbol] = { address: asset.address, decimals, raw: balance, formatted: formatUnits(balance, decimals) };
}
const marketSnapshots = [];
const priceSnapshotPath = "scripts/fixtures/robinhood-testnet-v3-prices.json";
let priorPrices;
try { priorPrices = read(priceSnapshotPath); } catch { /* First capture uses the existing configured markets. */ }
for (const market of catalog.pools) {
  const asset = assets.find((item) => item.id === market.assetA);
  const quote = assets.find((item) => item.id === market.assetB);
  const token0 = BigInt(asset.address) < BigInt(quote.address) ? asset.address : quote.address;
  const token1 = token0 === asset.address ? quote.address : asset.address;
  // The replacement factory has the standard fee tiers; its 100 tier is disabled.
  const fee = market.assetA === "weth" && market.fee === 100 ? 500 : market.fee;
  const spacing = await client.readContract({ address: factory, abi: factoryAbi, functionName: "feeAmountTickSpacing", args: [fee] });
  if (spacing <= 0) throw new Error(`${market.id} fee is not enabled`);
  const predicted = getCreate2Address({ from: factory, salt: keccak256(encodeAbiParameters(parseAbiParameters("address,address,uint24"), [token0, token1, fee])), bytecodeHash: poolInitCodehash });
  const existing = await client.readContract({ address: factory, abi: factoryAbi, functionName: "getPool", args: [token0, token1, fee] });
  if (existing !== zeroAddress && existing.toLowerCase() !== predicted.toLowerCase()) throw new Error("Replacement pool CREATE2 mismatch");
  const prior = priorPrices?.markets.find((item) => item.id === market.id);
  const sourcePool = prior?.sourcePool || market.address;
  const source = await Promise.all(["token0", "token1", "fee", "liquidity", "slot0"].map((functionName) => client.readContract({ address: sourcePool, abi: poolAbi, functionName })));
  if (source[0].toLowerCase() !== token0.toLowerCase() || source[1].toLowerCase() !== token1.toLowerCase() || source[2] !== (prior?.sourceFee || market.fee) || source[3] <= 0n || source[4][0] <= 0n) throw new Error(`${market.id} source market is not usable`);
  const sqrt = prior ? BigInt(prior.sqrtPriceX96) : source[4][0];
  const priceNumerator = (token0 === asset.address ? sqrt * sqrt : 1n << 192n) * 10n ** BigInt(asset.decimals);
  const priceDenominator = (token0 === asset.address ? 1n << 192n : sqrt * sqrt) * 10n ** BigInt(quote.decimals);
  const quoteRaw = BigInt(asset.id === "weth" ? 50 : 10) * 10n ** BigInt(quote.decimals);
  const assetRaw = quoteRaw * priceDenominator * 10n ** BigInt(asset.decimals) / (priceNumerator * 10n ** BigInt(quote.decimals));
  marketSnapshots.push({ id: market.id, asset: asset.symbol, quote: quote.symbol, assetAddress: asset.address,
    quoteAddress: quote.address, sourcePool, sourceBlock: prior?.sourceBlock || block.number, sqrtPriceX96: sqrt,
    priceUsdg: formatUnits(priceNumerator * 10n ** 12n / priceDenominator, 12), token0, token1,
    sourceFee: prior?.sourceFee || market.fee, fee, tickSpacing: spacing, tickLower: Math.ceil(-887272 / spacing) * spacing,
    tickUpper: Math.floor(887272 / spacing) * spacing, address: predicted, exists: existing !== zeroAddress,
    proposedAssetRaw: assetRaw, proposedQuoteRaw: quoteRaw,
    proposedAssetAmount: formatUnits(assetRaw, asset.decimals), proposedQuoteAmount: formatUnits(quoteRaw, quote.decimals) });
}
const report = { chainId: 46630, blockNumber: block.number, blockHash: block.hash, dependencies, poolInitCodehash,
  protocolWeth: config.externalContracts.weth, peripheryWeth: weth9, peripheryWethRuntime: wethCode,
  gasPriceWei: await client.getGasPrice(), fundingBudget: "scripts/fixtures/robinhood-testnet-v3-budget.json",
  balances, nativeBalanceWei: await client.getBalance({ address: config.deployer }), markets: marketSnapshots };
save("scripts/fixtures/robinhood-testnet-v3.json", report);
if (!priorPrices) save(priceSnapshotPath, { chainId: 46630, markets: marketSnapshots });
console.log(JSON.stringify({ block: block.number.toString(), balances, markets: marketSnapshots }, (_key, item) => typeof item === "bigint" ? item.toString() : item, 2));
