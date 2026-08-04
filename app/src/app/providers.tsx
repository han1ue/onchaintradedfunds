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
  const [palette, setPalette] = useState<"default" | "robinhood">("default");

  useEffect(() => {
    function syncAppearance() {
      setAppearance(document.documentElement.dataset.theme === "light" ? "light" : "dark");
      setPalette(document.documentElement.dataset.palette === "robinhood" ? "robinhood" : "default");
    }

    syncAppearance();
    const observer = new MutationObserver(syncAppearance);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-palette"],
    });
    return () => observer.disconnect();
  }, []);

  const walletTheme = useMemo(
    () => {
      const accentColor = palette === "robinhood"
        ? "#ccff00"
        : appearance === "light" ? "#13877e" : "#37b7aa";
      return appearance === "light"
        ? lightTheme({
            accentColor,
            accentColorForeground: palette === "robinhood" ? "#090909" : "#ffffff",
            borderRadius: "small",
            fontStack: "system",
            overlayBlur: "small",
          })
        : darkTheme({
            accentColor,
            accentColorForeground: "#071716",
            borderRadius: "small",
            fontStack: "system",
            overlayBlur: "small",
          });
    },
    [appearance, palette],
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
