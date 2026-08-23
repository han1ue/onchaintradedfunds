import { readFileSync } from "node:fs";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { LeaderboardEntry } from "@/lib/types";
import { ResponsiveLeaderboard } from "./Leaderboard";

const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
(globalThis as typeof globalThis & { React: typeof React }).React = React;

const entry: LeaderboardEntry = {
  id: "proposal-1",
  slug: "accessible-alpha",
  rank: 4,
  name: "Accessible Alpha",
  ticker: "A11Y",
  thesis: "A balanced portfolio for long-term onchain participation.",
  creator: {
    xId: "creator-1",
    username: "ada",
    displayName: "Ada",
    profileImageUrl: null,
  },
  votes: 1234,
  acceptedAt: "2026-08-01T00:00:00.000Z",
  verified: true,
  allocations: [
    { assetId: "asset-1", symbol: "ETH", name: "Ether", weightBps: 6000 },
    { assetId: "asset-2", symbol: "USDC", name: "USD Coin", weightBps: 4000 },
  ],
};

function channelToLinear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const channels = hex.match(/[a-f\d]{2}/gi)?.map((value) => channelToLinear(Number.parseInt(value, 16)));
  if (!channels || channels.length !== 3) throw new Error(`Expected a six-digit hex color, received ${hex}`);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function lightThemeToken(name: string): string {
  const lightTheme = styles.match(/:root\[data-theme="light"\]\s*{(?<tokens>[\s\S]*?)\n}/)?.groups?.tokens;
  const value = lightTheme?.match(new RegExp(`--${name}:\\s*(#[a-f\\d]{6})`, "i"))?.[1];
  if (!value) throw new Error(`Missing light-theme token --${name}`);
  return value.slice(1);
}

describe("leaderboard accessibility", () => {
  it("uses ordered-list semantics without masking linked row content", () => {
    const markup = renderToStaticMarkup(createElement(ResponsiveLeaderboard, { entries: [entry] }));

    expect(markup).toContain('<ol class="leaderboardList" role="list">');
    expect(markup).toContain('<li class="leaderboardItem">');
    expect(markup).toContain('href="/otfs/accessible-alpha"');
    expect(markup).not.toContain("View Accessible Alpha proposal details");
    expect(markup).toContain("Accessible Alpha");
    expect(markup).toContain("A balanced portfolio for long-term onchain participation.");
    expect(markup).toContain('aria-label="ETH 60%, USDC 40%"');
    expect(markup).toContain("@ada");
    expect(markup).toContain("1,234");
  });

  it("keeps the responsive and reduced-motion protections in place", () => {
    expect(styles).toMatch(/@media \(max-width: 760px\)[\s\S]*?\.leaderboardHeader\s*{\s*display:\s*none;/);
    expect(styles).not.toMatch(/\.leaderboardRow > \.allocationVisual\s*{\s*display:\s*none;/);
    expect(styles).not.toMatch(/\.creator\s*{\s*display:\s*none;/);
    expect(styles).toMatch(/\.leaderboardRow > \.allocationVisual\s*{[\s\S]*?clip:\s*rect\(0 0 0 0\);/);
    expect(styles).toMatch(/@media \(max-width: 760px\)[\s\S]*?\.creator\s*{[\s\S]*?clip:\s*rect\(0 0 0 0\);/);
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation:\s*none !important;/);
  });
});

describe("light-theme text contrast", () => {
  it.each(["text-muted", "teal", "green"])("keeps --%s at 4.5:1 or better on light surfaces", (token) => {
    const foreground = lightThemeToken(token);
    const surfaces = ["background", "nav", "card", "card-raised", "surface"].map(lightThemeToken);

    for (const background of surfaces) {
      expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
