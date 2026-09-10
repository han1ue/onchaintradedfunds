import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { compileUniversalRouter, universalRouterParameters, verifyUniversalRouter, v3PoolInitCodeHash } from "./lib/universal-router.mjs";
import { validateTestnetFlows } from "./validate-uniswap-v3-testnet-flows.mjs";

// All receipts stay in memory. Configuration stores addresses only for these contracts.
// Run against a local testnet fork first; broadcast requires the explicit mode and testnet RPC.
const root = resolve(import.meta.dirname, "..");
const requireApp = createRequire(resolve(root,"app/package.json"));
const { createPublicClient, createWalletClient, http, getAddress, encodeDeployData, parseAbi, decodeEventLog, keccak256 } = requireApp("viem");
const { privateKeyToAccount } = requireApp("viem/accounts");
const configPath = resolve(root,"app/src/config/robinhood-testnet.json");
const config = JSON.parse(readFileSync(configPath,"utf8"));
const pinPath = resolve(root,"scripts/fixtures/robinhood-testnet-routing.json");
const pin = JSON.parse(readFileSync(pinPath,"utf8"));
const broadcast = process.env.DEPLOYMENT_MODE === "broadcast";
const rpc = broadcast ? config.rpcUrl : (process.env.RH_TESTNET_RPC_URL || "http://127.0.0.1:8555");
if (config.chainId !== 46630 || (broadcast && rpc !== "https://rpc.testnet.chain.robinhood.com")
  || (!broadcast && !["localhost","127.0.0.1"].includes(new URL(rpc).hostname))) throw new Error("Testnet-only deployment guard");
if (!process.env.DEPLOYER_PRIVATE_KEY) process.loadEnvFile(resolve(root,".env.deploy.local"));
const account = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY);
const chain = { id:46630, name:"Robinhood testnet",nativeCurrency:{name:"Ether",symbol:"ETH",decimals:18},rpcUrls:{default:{http:[rpc]}} };
const client = createPublicClient({chain,transport:http(rpc,{timeout:60_000})});
const wallet = createWalletClient({account,chain,transport:http(rpc,{timeout:60_000})});
if (await client.getChainId() !== 46630) throw new Error("Wrong RPC chain");
if (getAddress(config.trustedRoles.protocolMultisig) !== account.address) throw new Error("Configured deployer cannot configure the protocol");
const c = config.externalContracts;
const abi = parseAbi(["function poolManager() view returns(address)","function entryExitRouter() view returns(address)","function factory() view returns(address)","function weth() view returns(address)","function buybackCollector() view returns(address)","function uniswapUniversalRouter() view returns(address)","function uniswapV3Factory() view returns(address)","function v3PoolInitCodeHash() view returns(bytes32)","function uniswapV4PoolManager() view returns(address)","function uniswapV4StateView() view returns(address)","function permit2() view returns(address)","function isAdapterApproved(address) view returns(bool)"]);
const read = (address,functionName,args=[]) => client.readContract({address,abi,functionName,args});
for (const [name,dependency] of Object.entries(pin.dependencies)) {
  if (name === "uniswapUniversalRouter") continue;
  if (c[name]?.toLowerCase() !== dependency.address.toLowerCase()) throw new Error(`Dependency configuration mismatch: ${name}`);
  const code = await client.getCode({address:dependency.address});
  if (!code || code === "0x" || (dependency.codehash && keccak256(code) !== dependency.codehash)) throw new Error(`Dependency runtime mismatch: ${name}`);
}
if (getAddress(await read(c.uniswapV4StateView,"poolManager")) !== getAddress(c.uniswapV4PoolManager)) throw new Error("StateView binding mismatch");
let gasUsed = 0n;
// Read every artifact before submitting a transaction, including resumed configurations.
const artifacts = Object.fromEntries(["BuybackCollector", "ManagedOTFVault", "OTFFactory", "OTFEntryExitRouter", "UniswapUniversalRouterAdapter"].map(name =>
  [name, JSON.parse(readFileSync(resolve(root,`contracts/out/${name}.sol/${name}.json`),"utf8"))]));
const deployed = {};
let factoryCreationBlock;
const receipt = async hash => {
  const result = await client.waitForTransactionReceipt({hash});
  if (result.status !== "success") throw new Error("Testnet transaction reverted");
  gasUsed += result.gasUsed;
  return result;
};
const deploy = async (name,args=[],custom) => {
  const a = custom ?? artifacts[name];
  const object = custom ? a.evm.bytecode.object : a.bytecode.object;
  const data = encodeDeployData({abi:a.abi,bytecode:object.startsWith("0x")?object:`0x${object}`,args});
  const gas = await client.estimateGas({account,data});
  const result = await receipt(await wallet.sendTransaction({data,gas:gas*12n/10n}));
  if (!result.contractAddress) throw new Error("Missing contract address");
  const address = getAddress(result.contractAddress);
  if (name === "OTFFactory") factoryCreationBlock = result.blockNumber.toString();
  deployed[name] = { address,abi:a.abi };
  console.log(`${name}: ${address}`);
  return address;
};
const transact = async (name,functionName,args) => {
  const contract = deployed[name];
  const {request} = await client.simulateContract({...contract,functionName,args,account});
  return receipt(await wallet.writeContract(request));
};
const persist = () => {
  if (!broadcast) return;
  writeFileSync(configPath,JSON.stringify(config,null,2)+"\n");
  writeFileSync(pinPath,JSON.stringify(pin,null,2)+"\n");
};
const universal = config.routing.status === "configuring"
  ? getAddress(c.uniswapUniversalRouter)
  : await deploy("UniversalRouter",[universalRouterParameters(config)],compileUniversalRouter());
await verifyUniversalRouter(client,config,universal);
c.uniswapUniversalRouter = universal;
pin.dependencies.uniswapUniversalRouter = { address:universal };
delete pin.universalRouterSource;
delete config.expectedCodehashes.uniswapUniversalRouter;
delete config.deployer;
delete config.deployedAt;
// Keep the app disabled until the complete immutable binding graph is configured.
config.routing.status = "configuring";
persist();
const collector = await deploy("BuybackCollector",[config.contracts.launchManager.address,universal,c.permit2]);
const implementation = await deploy("ManagedOTFVault");
const factory = await deploy("OTFFactory",[implementation,collector,config.contracts.otfToken.address]);
const router = await deploy("OTFEntryExitRouter",[factory,config.trustedRoles.protocolMultisig,c.weth]);
const adapter = await deploy("UniswapUniversalRouterAdapter",[router,c.uniswapV3Factory,v3PoolInitCodeHash,c.uniswapV4PoolManager,c.uniswapV4StateView,universal,c.permit2]);
await transact("BuybackCollector","configureFactory",[factory]);
await transact("OTFFactory","configureEntryExitRouter",[router]);
await transact("OTFEntryExitRouter","setAdapterApproved",[adapter,true]);
const samples = [];
for (const previous of config.sampleOtfs) {
  const {address:_address,transactionHash:_hash,blockNumber:_block,gasUsed:_gas,...params} = previous;
  const result = await transact("OTFFactory","createVault",[{...params,bootstrapBasketUnitsPerOTF:params.bootstrapBasketUnitsPerOTF.map(BigInt)}]);
  const event = result.logs.map(log=>{try{return decodeEventLog({abi:deployed.OTFFactory.abi,...log});}catch{return undefined;}}).find(log=>log?.eventName==="VaultCreated");
  if (!event) throw new Error("Missing vault creation event");
  const vault = getAddress(event.args.vault);
  if (getAddress(await read(vault,"entryExitRouter")) !== router || getAddress(await read(vault,"buybackCollector")) !== collector) throw new Error("Vault binding mismatch");
  samples.push({...params,address:vault});
}
for (const [address,method,expected] of [[collector,"factory",factory],[factory,"entryExitRouter",router],[router,"factory",factory],[router,"weth",c.weth],[adapter,"entryExitRouter",router],[adapter,"weth",c.weth],[adapter,"uniswapV3Factory",c.uniswapV3Factory],[adapter,"uniswapV4PoolManager",c.uniswapV4PoolManager],[adapter,"uniswapV4StateView",c.uniswapV4StateView],[adapter,"uniswapUniversalRouter",universal],[adapter,"permit2",c.permit2]]) {
  if (getAddress(await read(address,method)) !== getAddress(expected)) throw new Error(`Protocol ${method} binding mismatch`);
}
if ((await read(adapter,"v3PoolInitCodeHash")).toLowerCase() !== v3PoolInitCodeHash || !await read(router,"isAdapterApproved",[adapter])) throw new Error("Adapter configuration mismatch");
Object.assign(config.contracts,{buybackCollector:{address:collector},vaultImplementation:{address:implementation},factory:{address:factory,blockNumber:factoryCreationBlock},entryRouter:{address:router},uniswapUniversalRouterAdapter:{address:adapter}});
config.sampleOtfs = samples;
for (const key of ["collectorFactory", "factoryRouter", "adapterApproval", "sampleOtfCreations"]) delete config.setupTransactions[key];
config.routing.v4RouteData = "0x04 || abi.encode(address currencyIn, PathKey[] path)";
Object.assign(config.routing,{status:"ready",approvedAdapters:[adapter],uniswapUniversalRouterAdapter:adapter});
if (!broadcast) await validateTestnetFlows(config,pin,rpc);
persist();
console.log(`${broadcast?"Testnet":"Local testnet fork"} binding verification passed; total execution gas ${gasUsed}.`);
