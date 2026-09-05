import type { Metadata } from "next";
import otfFavicon from "@onchaintradedfunds/brand/assets/otf-favicon.svg";
import { Head } from "nextra/components";
import { getPageMap } from "nextra/page-map";
import { Footer, Layout, Navbar } from "nextra-theme-docs";
import type { ReactNode } from "react";
import "nextra-theme-docs/style.css";
import "./styles.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://docs.onchaintradedfunds.com"),
  title: {
    default: "Onchain Traded Funds documentation",
    template: "%s | Onchain Traded Funds",
  },
  description: "Protocol, security, and incentive documentation for Onchain Traded Funds.",
  icons: { icon: { url: otfFavicon.src, type: "image/svg+xml", sizes: "any" } },
};

const logo = (
  <span className="otf-docs-brand">
    <span className="otf-docs-mark" aria-hidden="true">OTF</span>
    <span>Documentation</span>
  </span>
);

const navbar = (
  <Navbar
    logo={logo}
    logoLink="/"
    projectLink="https://github.com/han1ue/onchaintradedfunds"
  >
    <a className="otf-open-app" href="https://app.onchaintradedfunds.com">
      Open app
    </a>
  </Navbar>
);

const footer = (
  <Footer>
    <span className="otf-footer-content">
      <span>Onchain Traded Funds · Experimental, unaudited, and pre-mainnet.</span>
      <a href="https://app.onchaintradedfunds.com">Open app</a>
    </span>
  </Footer>
);

export default async function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <Head
        color={{
          hue: 174,
          saturation: 53,
          lightness: { light: 30, dark: 57 },
        }}
        backgroundColor={{ light: "#f5f8f7", dark: "#0e1218" }}
      />
      <body>
        <template
          data-impeccable-direction="user-pinned-nextra"
          dangerouslySetInnerHTML={{
            __html: `<!--
THESIS: A calm technical reference that makes protocol truth easy to find; it refuses a marketing landing page disguised as documentation.
OWN-WORLD: Nextra structure on deep slate, quiet ledger rules, workhorse sans typography, and scarce teal reserved for active paths.
STORY: Readers orient in the overview, move through normative security and incentive documents, search exact terms, then return to the app or repository.
FIRST VIEWPORT: Compact brand navigation, persistent document tree, readable article measure, and an immediate page outline with no promotional hero.
FORM: User-pinned Nextra Read surface; established-world extension; seed user-pinned-nextra.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
-->`,
          }}
        />
        <Layout
          navbar={navbar}
          pageMap={await getPageMap()}
          docsRepositoryBase="https://github.com/han1ue/onchaintradedfunds/tree/main/docs"
          footer={footer}
          copyPageButton={false}
          nextThemes={{ defaultTheme: "dark" }}
          sidebar={{ autoCollapse: true, defaultMenuCollapseLevel: 1 }}
          toc={{ title: "On this page", backToTop: "Back to top", float: false }}
          editLink="Edit this page"
          feedback={{ content: "Report a documentation issue" }}
        >
          {children}
        </Layout>
      </body>
    </html>
  );
}
