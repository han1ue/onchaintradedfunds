"use client";

import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { injectedWallet, rainbowWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { robinhoodChain, robinhoodChainTestnet } from "./chains";

const walletConnectProjectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "00000000000000000000000000000000";

const connectors = connectorsForWallets(
  [
    {
      groupName: "Recommended",
      wallets: [rainbowWallet, injectedWallet, walletConnectWallet],
    },
  ],
  {
    appName: "Onchain Traded Funds",
    projectId: walletConnectProjectId,
  },
);

export const wagmiConfig = createConfig({
  chains: [robinhoodChainTestnet, robinhoodChain],
  connectors,
  transports: {
    [robinhoodChainTestnet.id]: http(
      process.env.NEXT_PUBLIC_RH_TESTNET_RPC_URL || "http://127.0.0.1:8545",
    ),
    [robinhoodChain.id]: http(process.env.NEXT_PUBLIC_RH_RPC_URL || "https://placeholder.invalid"),
  },
  ssr: true,
});
