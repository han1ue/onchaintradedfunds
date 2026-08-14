"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    twttr?: { widgets?: { load(element?: HTMLElement): void } };
  }
}

export function XPostEmbed({ html }: { html: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const renderEmbed = useCallback(() => {
    if (!rootRef.current) return;
    rootRef.current.querySelector("blockquote.twitter-tweet")?.setAttribute("data-theme", theme);
    window.twttr?.widgets?.load(rootRef.current);
  }, [theme]);

  useEffect(() => {
    const syncTheme = () => setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  useEffect(renderEmbed, [html, renderEmbed]);

  return <div className="xPostEmbed" ref={rootRef}>
    <div className="xPostEmbedBody" key={theme} dangerouslySetInnerHTML={{ __html: html }} />
    <Script src="https://platform.twitter.com/widgets.js" strategy="afterInteractive" onReady={renderEmbed} />
  </div>;
}
