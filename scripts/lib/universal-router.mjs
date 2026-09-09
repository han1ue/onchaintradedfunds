import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import solc from "solc";

const root = resolve(import.meta.dirname, "../..");
const { keccak256, zeroAddress } = createRequire(resolve(root,"app/package.json"))("viem");
export const UNIVERSAL_ROUTER_RELEASE = "999d561c3ad58fb5cab91b602911f3c75591a9c7";
export const v3PoolInitCodeHash = keccak256(JSON.parse(readFileSync(resolve(root,"node_modules/@uniswap/v3-core/artifacts/contracts/UniswapV3Pool.sol/UniswapV3Pool.json"),"utf8")).bytecode);

export function universalRouterParameters(config) {
  const c = config.externalContracts;
  return { permit2:c.permit2,weth9:c.weth,v2Factory:zeroAddress,v3Factory:c.uniswapV3Factory,pairInitCodeHash:`0x${"00".repeat(32)}`,poolInitCodeHash:v3PoolInitCodeHash,
    v4PoolManager:c.uniswapV4PoolManager,v3NFTPositionManager:c.uniswapV3PositionManager??zeroAddress,v4PositionManager:c.uniswapV4PositionManager,spokePool:zeroAddress };
}

let compiled;
export function compileUniversalRouter() {
  if (compiled) return compiled;
  const source = "contracts/UniversalRouter.sol";
  const sourcePath = path => {
    const mappings = [
      ["contracts/","@uniswap/universal-router/contracts/"],
      ["@openzeppelin/contracts/","openzeppelin-contracts/"],
      ["@uniswap/v3-periphery/","universal-router-v3-periphery/"],
      ["solmate/","universal-router-solmate/"],
      ["permit2/","@uniswap/permit2/"],
    ];
    const mapping = mappings.find(([prefix])=>path.startsWith(prefix));
    return resolve(root,"node_modules",mapping?mapping[1]+path.slice(mapping[0].length):path);
  };
  const output=JSON.parse(solc.compile(JSON.stringify({language:"Solidity",sources:{[source]:{content:readFileSync(sourcePath(source),"utf8")}},settings:{optimizer:{enabled:true,runs:4444},viaIR:true,evmVersion:"cancun",metadata:{bytecodeHash:"none"},outputSelection:{"*":{"*":["abi","evm.bytecode.object","evm.deployedBytecode"],"":["ast"]}}}}),{import:path=>{try{return{contents:readFileSync(sourcePath(path),"utf8")};}catch{return{error:`Missing pinned router dependency: ${path}`};}}}));
  const errors=(output.errors??[]).filter(error=>error.severity==="error");
  if(errors.length)throw new Error(errors.map(error=>error.formattedMessage).join("\n"));
  const names=new Map();
  const visit=node=>{if(!node||typeof node!=="object")return;if(node.nodeType==="VariableDeclaration")names.set(String(node.id),node.name);for(const value of Object.values(node))if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==="object")visit(value);};
  Object.values(output.sources).forEach(source=>visit(source.ast));
  const artifact=output.contracts[source].UniversalRouter;
  compiled={...artifact,immutableNames:names};
  return compiled;
}

/** Compares every non-immutable byte and verifies the bindings used by V3/V4 swaps. No records are written. */
export async function verifyUniversalRouter(client, config, address=config.externalContracts.uniswapUniversalRouter) {
  if(await client.getChainId()!==config.chainId)throw new Error("Wrong router verification chain");
  const artifact=compileUniversalRouter();
  const runtime=await client.getCode({address});
  if(!runtime||runtime==="0x")throw new Error("Missing Universal Router code");
  let actual=runtime.slice(2).toLowerCase(),expected=artifact.evm.deployedBytecode.object.toLowerCase();
  if(actual.length!==expected.length)throw new Error(`Universal Router release mismatch (${actual.length/2} vs ${expected.length/2} bytes)`);
  const c=config.externalContracts;
  const bindings={WETH9:c.weth,PERMIT2:c.permit2,UNISWAP_V3_FACTORY:c.uniswapV3Factory,UNISWAP_V3_POOL_INIT_CODE_HASH:v3PoolInitCodeHash,poolManager:c.uniswapV4PoolManager};
  const checked=new Set();
  for(const [id,locations] of Object.entries(artifact.evm.deployedBytecode.immutableReferences)) {
    const name=artifact.immutableNames.get(id),binding=bindings[name];
    for(const {start,length} of locations) {
      const value=actual.slice(start*2,(start+length)*2);
      if(binding && value!==binding.slice(2).toLowerCase().padStart(length*2,"0"))throw new Error(`Universal Router ${name} binding mismatch`);
      actual=actual.slice(0,start*2)+"0".repeat(length*2)+actual.slice((start+length)*2);
      expected=expected.slice(0,start*2)+"0".repeat(length*2)+expected.slice((start+length)*2);
    }
    if(binding)checked.add(name);
  }
  if(actual!==expected || checked.size!==Object.keys(bindings).length)throw new Error("Universal Router does not match the pinned release");
  for(const dependency of [c.weth,c.permit2,c.uniswapV3Factory,c.uniswapV4PoolManager,c.uniswapV4StateView]) {
    const code=await client.getCode({address:dependency});if(!code||code==="0x")throw new Error("Missing swap dependency code");
  }
  return artifact;
}
