"use client";

import { AlertTriangle, Droplets, ExternalLink, Info } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { getAddress, isAddress } from "viem";
import { useChainId, useReadContract } from "wagmi";
import { Providers } from "@/app/providers";
import { robinhoodChain, robinhoodChainTestnet } from "@/lib/chains";
import { robinhoodTestnetAddresses, robinhoodTestnetMarketAssets } from "@/lib/deployment";
import { selectV3Pool, useDiscoveredV3Pools, type V3TokenPair } from "@/lib/v3-execution-routes";
import { TopNav } from "./RebalanceCooldownPanel";

const SYNTHRA_LIQUIDITY_URL = "https://app.synthra.org/#/add/ETH";
const UNISWAP_LIQUIDITY_URL = "https://app.uniswap.org/positions?chain=robinhood";

const otfFactoryAbi = [{
  type: "function",
  name: "isVault",
  stateMutability: "view",
  inputs: [{ type: "address", name: "vault" }],
  outputs: [{ type: "bool" }],
}] as const;

function shortAddress(value: string | undefined): string {
  return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "Not found";
}

function LiquidityWorkspace() {
  const chainId = useChainId();
  const isMainnet = chainId === robinhoodChain.id;
  const initialVault = typeof window === "undefined"
    ? ""
    : new URLSearchParams(window.location.search).get("vault") ?? "";
  const initialQuote = typeof window === "undefined"
    ? ""
    : new URLSearchParams(window.location.search).get("quote") ?? "";
  const [otfAddress, setOtfAddress] = useState(initialVault);
  const [quoteChoice, setQuoteChoice] = useState(
    robinhoodTestnetMarketAssets.some((asset) => asset.token.toLowerCase() === initialQuote.toLowerCase())
      ? initialQuote
      : robinhoodTestnetMarketAssets[0]?.token ?? "",
  );

  const validOtfAddress = isAddress(otfAddress) ? getAddress(otfAddress) : undefined;
  const selectedMarketAsset = robinhoodTestnetMarketAssets.find(
    (asset) => asset.token.toLowerCase() === quoteChoice.toLowerCase(),
  ) ?? robinhoodTestnetMarketAssets[0];
  const discoveryPairs = useMemo<V3TokenPair[]>(
    () => validOtfAddress
      ? robinhoodTestnetMarketAssets.map((marketAsset) => ({
          tokenA: validOtfAddress,
          tokenB: marketAsset.token,
        }))
      : [],
    [validOtfAddress],
  );
  const {
    pools: discoveredPools,
    isLoading: poolDiscoveryLoading,
    isError: poolDiscoveryError,
  } = useDiscoveredV3Pools(
    discoveryPairs,
    !isMainnet && Boolean(robinhoodTestnetAddresses.uniswapV3Factory && discoveryPairs.length),
  );
  const selectedPool = validOtfAddress && selectedMarketAsset
    ? selectV3Pool(discoveredPools, validOtfAddress, selectedMarketAsset.token)
    : undefined;
  const { data: isFactoryOtf, isLoading: otfLoading, isError: otfError } = useReadContract({
    address: robinhoodTestnetAddresses.factory,
    abi: otfFactoryAbi,
    functionName: "isVault",
    args: validOtfAddress ? [validOtfAddress] : undefined,
    chainId: robinhoodChainTestnet.id,
    query: {
      enabled: Boolean(!isMainnet && robinhoodTestnetAddresses.factory && validOtfAddress),
    },
  });

  const venueName = isMainnet ? "Uniswap" : "Synthra";
  const venueUrl = isMainnet ? UNISWAP_LIQUIDITY_URL : SYNTHRA_LIQUIDITY_URL;
  const marketState = poolDiscoveryLoading
    ? "Checking"
    : selectedPool?.readFailed
      ? "Read unavailable"
      : selectedPool?.liquidity && selectedPool.liquidity > 0n
        ? "Active liquidity"
        : selectedPool
          ? "Pool found · no active liquidity"
          : "No pool";

  function changeView(tab: string) {
    if (tab === "Verified") window.location.assign("/verified");
    else if (tab !== "Liquidity") window.location.assign("/otfs");
  }

  return (
    <div className="appShell">
      <TopNav
        activeTab="Liquidity"
        depositsActive={false}
        onHome={() => window.location.assign("/")}
        onTabChange={changeView}
        onOpenDeposits={() => window.location.assign("/wallet")}
      />
      <main className="dashboardMain liquidityPage">
        <div className="liquidityBreadcrumb">
          <Link href="/otfs">OTFs</Link><span>/</span><strong>Liquidity</strong>
        </div>

        <section className="liquidityIntro">
          <div>
            <h1>OTF liquidity markets</h1>
            <p>Inspect supported markets here. Pool creation and every liquidity-position action happen on the network&apos;s external liquidity venue.</p>
          </div>
          <div className="liquidityBadges" aria-label="Liquidity venues">
            <span>{venueName}</span>
            <span>{isMainnet ? "Mainnet" : "Testnet"}</span>
          </div>
        </section>

        <div className="liquidityLayout">
          <aside className="liquidityMarketPanel">
            <div className="liquidityPanelHeading">
              <Droplets size={16} />
              <div><strong>Market discovery</strong><span>{isMainnet ? "Mainnet discovery will follow the production deployment." : "Pools are read directly from the Synthra V3 factory."}</span></div>
            </div>

            {!isMainnet ? (
              <>
                <label className="liquidityField">
                  <span>OTF address</span>
                  <input value={otfAddress} onChange={(event) => setOtfAddress(event.target.value.trim())} placeholder="0x…" />
                  <small>Enter a Robinhood Chain Testnet OTF address.</small>
                </label>

                <div className="liquidityField">
                  <span>Settlement asset</span>
                  <div className="liquidityQuoteChoices" role="list" aria-label="Supported OTF market assets">
                    {robinhoodTestnetMarketAssets.map((marketAsset) => {
                      const active = marketAsset.token.toLowerCase() === selectedMarketAsset?.token.toLowerCase();
                      const pool = validOtfAddress
                        ? selectV3Pool(discoveredPools, validOtfAddress, marketAsset.token)
                        : undefined;
                      return (
                        <button
                          className={active ? "active" : ""}
                          type="button"
                          key={marketAsset.token}
                          onClick={() => setQuoteChoice(marketAsset.token)}
                        >
                          <strong>{marketAsset.symbol}</strong>
                          <span>{poolDiscoveryLoading ? "Checking" : pool ? "Pool found" : "No pool"}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="liquidityPoolRecord">
                  <div><span>Selected market</span><strong>OTF / {selectedMarketAsset?.symbol ?? "quote"}</strong></div>
                  <div><span>Pool</span><strong>{shortAddress(selectedPool?.address)}</strong></div>
                  <div><span>Fee tier</span><strong>{selectedPool ? `${selectedPool.fee / 10_000}%` : "—"}</strong></div>
                  <div><span>Market state</span><strong>{marketState}</strong></div>
                </div>

                {selectedPool ? (
                  <a className="liquidityExplorerLink" href={`${robinhoodChainTestnet.blockExplorers.default.url}/address/${selectedPool.address}`} target="_blank" rel="noreferrer">
                    Inspect pool contract <ExternalLink size={12} />
                  </a>
                ) : null}
                {validOtfAddress && robinhoodTestnetAddresses.factory && !otfLoading && !otfError && isFactoryOtf === false ? (
                  <div className="validationSummary"><AlertTriangle size={15} /><div><strong>OTF not found</strong><span>This address is not registered by the configured factory.</span></div></div>
                ) : null}
                {validOtfAddress && (otfError || poolDiscoveryError) ? (
                  <div className="validationSummary danger"><AlertTriangle size={15} /><div><strong>Market read unavailable</strong><span>Check the network connection and try again.</span></div></div>
                ) : null}
                {validOtfAddress && !poolDiscoveryLoading && !selectedPool ? (
                  <div className="validationSummary"><Info size={15} /><div><strong>No {selectedMarketAsset?.symbol} pool yet</strong><span>The OTF exists normally without this market.</span></div></div>
                ) : null}
              </>
            ) : (
              <div className="validationSummary"><Info size={15} /><div><strong>Mainnet markets are not indexed yet</strong><span>Use Uniswap to create pools and manage positions. Discovery will appear after the production deployment is configured.</span></div></div>
            )}
          </aside>

          <section className="liquidityVenuePanel">
            <div className="liquidityPanelHeading">
              <ExternalLink size={16} />
              <div><strong>Manage on {venueName}</strong><span>{isMainnet ? "Robinhood Chain Mainnet" : "Robinhood Chain Testnet"}</span></div>
            </div>
            <div className="liquidityVenueMessage">
              <strong>One venue for the complete liquidity lifecycle</strong>
              <p>Create a pool, choose its initial price, add or remove liquidity, collect fees, and manage positions directly on {venueName}.</p>
            </div>
            <a className="primaryAction liquidityVenueAction" href={venueUrl} target="_blank" rel="noreferrer">
              Open {venueName} liquidity <ExternalLink size={14} />
            </a>
            <p className="liquidityHelper">The OTF app never takes custody of liquidity-position assets or submits pool-management transactions.</p>
          </section>
        </div>

        <footer className="dashboardFooter">
          <span>External, wallet-owned liquidity · portfolio assets are never used</span>
          <Link href="/docs">Docs</Link>
        </footer>
      </main>
    </div>
  );
}

export function LiquidityManager() {
  return <Providers><LiquidityWorkspace /></Providers>;
}
