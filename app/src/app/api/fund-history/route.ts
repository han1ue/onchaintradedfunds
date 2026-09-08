import { isAddress, getAddress } from "viem";
import { readFundHistory } from "@/server/nav";
export const dynamic="force-dynamic";
export async function GET(request:Request) {
  const params=new URL(request.url).searchParams,chainId=Number(params.get("chainId")),address=params.get("address");
  if (![4663,46630].includes(chainId)||!address||!isAddress(address)) return Response.json({error:"INVALID_FUND"},{status:400});
  try { return Response.json(await readFundHistory(chainId,getAddress(address)),{headers:{"cache-control":"no-store"}}); }
  catch { return Response.json({error:"HISTORY_UNAVAILABLE"},{status:503}); }
}
