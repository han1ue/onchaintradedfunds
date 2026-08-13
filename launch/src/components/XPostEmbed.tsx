"use client";

import { ExternalLink } from "lucide-react";
import Script from "next/script";
import { useCallback, useEffect, useRef } from "react";

declare global {
  interface Window {
    twttr?: { widgets?: { load(element?: HTMLElement): void } };
  }
}

export function XPostEmbed({ html, postUrl }: { html?: string | null; postUrl: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const renderEmbed = useCallback(() => {
    if (rootRef.current) window.twttr?.widgets?.load(rootRef.current);
  }, []);

  useEffect(renderEmbed, [html, renderEmbed]);

  return <div className="xPostEmbed" ref={rootRef}>
    {html && <div className="xPostEmbedBody" dangerouslySetInnerHTML={{ __html: html }} />}
    {html && <Script src="https://platform.twitter.com/widgets.js" strategy="afterInteractive" onReady={renderEmbed} />}
    <a className="xPostEmbedFallback" href={postUrl} target="_blank" rel="noreferrer">
      Open verified post on X <ExternalLink size={13} />
    </a>
  </div>;
}
