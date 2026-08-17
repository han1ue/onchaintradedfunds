const selectors = {
  name: "0x06fdde03",
  symbol: "0x95d89b41",
  decimals: "0x313ce567",
  totalSupply: "0x18160ddd",
} as const;

function stripHexPrefix(value: string) {
  return value.startsWith("0x") ? value.slice(2) : value;
}

export function decodeErc20Text(value: string) {
  const hex = stripHexPrefix(value);
  if (!hex || hex.length % 2 !== 0) throw new Error("TOKEN_METADATA_UNAVAILABLE");

  let textHex = hex;
  if (hex.length >= 128) {
    const offset = Number(BigInt(`0x${hex.slice(0, 64)}`)) * 2;
    const lengthWord = hex.slice(offset, offset + 64);
    if (lengthWord.length !== 64) throw new Error("TOKEN_METADATA_UNAVAILABLE");
    const length = Number(BigInt(`0x${lengthWord}`));
    textHex = hex.slice(offset + 64, offset + 64 + length * 2);
  }

  const decoded = Buffer.from(textHex, "hex").toString("utf8").replace(/\0+$/g, "").trim();
  if (!decoded) throw new Error("TOKEN_METADATA_UNAVAILABLE");
  return decoded;
}

function decodeUint(value: string) {
  const hex = stripHexPrefix(value);
  if (!hex) throw new Error("TOKEN_METADATA_UNAVAILABLE");
  return Number(BigInt(`0x${hex}`));
}

async function ethCall(rpcUrl: string, address: string, data: string) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: address, data }, "latest"] }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("TOKEN_METADATA_UNAVAILABLE");
  const payload = await response.json() as { result?: unknown; error?: unknown };
  if (typeof payload.result !== "string" || payload.error) throw new Error("TOKEN_METADATA_UNAVAILABLE");
  return payload.result;
}

export async function getTokenMetadata(address: string, rpcUrl: string) {
  const [nameResult, symbolResult, decimalsResult, totalSupplyResult] = await Promise.all([
    ethCall(rpcUrl, address, selectors.name),
    ethCall(rpcUrl, address, selectors.symbol),
    ethCall(rpcUrl, address, selectors.decimals),
    ethCall(rpcUrl, address, selectors.totalSupply),
  ]);
  decodeUint(totalSupplyResult);
  return {
    name: decodeErc20Text(nameResult),
    symbol: decodeErc20Text(symbolResult).toUpperCase(),
    decimals: decodeUint(decimalsResult),
  };
}
