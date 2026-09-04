"use client";

import "@rainbow-me/rainbowkit/styles.css";

import { darkTheme, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/lib/wagmi";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const walletTheme = darkTheme({
    accentColor: "#ccff00",
    accentColorForeground: "#090909",
    borderRadius: "small",
    fontStack: "system",
    overlayBlur: "small",
  });

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          appInfo={{
            appName: "Onchain Traded Funds",
            learnMoreUrl: "https://github.com/han1ue/onchaintradedfunds#readme",
          }}
          modalSize="compact"
          theme={walletTheme}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
