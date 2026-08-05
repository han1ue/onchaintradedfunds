"use client";

import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { injectedWallet, rainbowWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { robinhoodChain, robinhoodChainTestnet } from "./chains";

const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
const wallets = walletConnectProjectId
  ? [rainbowWallet, injectedWallet, walletConnectWallet]
  : [injectedWallet];

const connectors = connectorsForWallets(
  [
    {
      groupName: "Recommended",
      wallets,
    },
  ],
  {
    appName: "Onchain Traded Funds",
    projectId: walletConnectProjectId || "injected-wallets-only",
  },
);

export const wagmiConfig = createConfig({
  chains: [robinhoodChainTestnet, robinhoodChain],
  connectors,
  transports: {
    [robinhoodChainTestnet.id]: http(
      process.env.NEXT_PUBLIC_RH_TESTNET_RPC_URL || "https://rpc.testnet.chain.robinhood.com",
    ),
    [robinhoodChain.id]: http(
      process.env.NEXT_PUBLIC_RH_RPC_URL || "https://rpc.mainnet.chain.robinhood.com",
    ),
  },
  ssr: true,
});
