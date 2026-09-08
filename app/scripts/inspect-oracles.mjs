import {database} from '../src/server/database.ts';
import {createPublicClient,http,parseAbi} from 'viem';
const {sql,schema}=database();
const sources=await sql.query(`SELECT id,oracle_address,validation_metadata FROM ${schema}.asset_price_sources WHERE chain_id=46630 AND source_type='chainlink' ORDER BY id`);
const client=createPublicClient({transport:http(process.env.RH_TESTNET_RPC_URL||'https://rpc.testnet.chain.robinhood.com',{timeout:10000,retryCount:0})});
const abi=parseAbi(['function description() view returns(string)','function decimals() view returns(uint8)','function latestRoundData() view returns(uint80,int256,uint256,uint256,uint80)']);
const rows=await Promise.all(sources.map(async source=>{
  try {
    const [description,decimals,round]=await Promise.all(['description','decimals','latestRoundData'].map(functionName=>client.readContract({address:source.oracle_address,abi,functionName})));
    return {id:source.id,expected:source.validation_metadata.expectedDescription,description,decimals,round:round.map(String)};
  } catch{return {id:source.id,error:'ORACLE_READ_FAILED'};}
}));
console.log(JSON.stringify(rows,null,2));
