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
  const bodyRef = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [loading, setLoading] = useState(true);
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

  useEffect(() => {
    const root = rootRef.current;
    const body = bodyRef.current;
    if (!root || !body) return;
    let renderedIframe: HTMLIFrameElement | null = null;
    const finishLoading = () => setLoading(false);
    setLoading(true);
    body.innerHTML = html;
    const watchRenderedPost = () => {
      const iframe = root.querySelector<HTMLIFrameElement>('iframe.twitter-tweet-rendered, iframe[id^="twitter-widget-"]');
      if (!iframe || iframe === renderedIframe) return;
      renderedIframe?.removeEventListener("load", finishLoading);
      renderedIframe = iframe;
      iframe.addEventListener("load", finishLoading, { once: true });
    };
    const observer = new MutationObserver(watchRenderedPost);
    observer.observe(root, { childList: true, subtree: true });
    watchRenderedPost();
    return () => {
      observer.disconnect();
      renderedIframe?.removeEventListener("load", finishLoading);
    };
  }, [html, theme]);

  useEffect(renderEmbed, [html, renderEmbed]);

  return <div className={`xPostEmbed${loading ? " isLoading" : ""}`} ref={rootRef} aria-busy={loading}>
    {loading && <div className="xPostLoading" role="status"><span className="xPostLoadingBall" aria-hidden="true" /><span className="srOnly">Loading X post</span></div>}
    <div className="xPostEmbedBody" ref={bodyRef} aria-hidden={loading} />
    <Script src="https://platform.twitter.com/widgets.js" strategy="afterInteractive" onReady={renderEmbed} />
  </div>;
}
