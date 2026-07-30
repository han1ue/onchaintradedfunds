"use client";

import "@rainbow-me/rainbowkit/styles.css";

import { darkTheme, lightTheme, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/lib/wagmi";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [appearance, setAppearance] = useState<"dark" | "light">("dark");

  useEffect(() => {
    function syncAppearance() {
      setAppearance(document.documentElement.dataset.theme === "light" ? "light" : "dark");
    }

    syncAppearance();
    const observer = new MutationObserver(syncAppearance);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  const walletTheme = useMemo(
    () =>
      appearance === "light"
        ? lightTheme({
            accentColor: "#13877e",
            accentColorForeground: "#ffffff",
            borderRadius: "small",
            fontStack: "system",
            overlayBlur: "small",
          })
        : darkTheme({
            accentColor: "#37b7aa",
            accentColorForeground: "#071716",
            borderRadius: "small",
            fontStack: "system",
            overlayBlur: "small",
          }),
    [appearance],
  );

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          appInfo={{
            appName: "Onchain Traded Funds",
            learnMoreUrl: "/docs",
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
