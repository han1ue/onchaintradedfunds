import { getAddress } from "viem";
import testnet from "../config/robinhood-testnet.json";

// Contract bindings belong to the deployment manifest, never to the operational registry.
export const testnetVenue = Object.freeze({
  id: "uniswap-v3", name: "Uniswap V3", baseUrl: testnet.externalLiquidity.baseUrl,
  factory: getAddress(testnet.externalContracts.uniswapV3Factory),
  swapRouter02: getAddress(testnet.externalContracts.uniswapV3SwapRouter02),
  quoter: getAddress(testnet.externalContracts.uniswapV3QuoterV2),
  positionManager: getAddress(testnet.externalContracts.uniswapV3PositionManager),
  weth9: getAddress(testnet.externalContracts.uniswapV3Weth9),
});
