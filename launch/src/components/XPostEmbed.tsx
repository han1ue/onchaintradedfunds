"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef } from "react";

declare global {
  interface Window {
    twttr?: { widgets?: { load(element?: HTMLElement): void } };
  }
}

export function XPostEmbed({ html }: { html: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const renderEmbed = useCallback(() => {
    if (rootRef.current) window.twttr?.widgets?.load(rootRef.current);
  }, []);

  useEffect(renderEmbed, [html, renderEmbed]);

  return <div className="xPostEmbed" ref={rootRef}>
    <div className="xPostEmbedBody" dangerouslySetInnerHTML={{ __html: html }} />
    <Script src="https://platform.twitter.com/widgets.js" strategy="afterInteractive" onReady={renderEmbed} />
  </div>;
}
