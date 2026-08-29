import Link from "next/link";
import { ArrowUpRight, ExternalLink } from "lucide-react";
import { DocsNavigation } from "./DocsNavigation";

const groups = [
  {
    label: "Protocol",
    sections: [
      ["formation", "Formation"],
      ["creation", "Creation input"],
      ["fees", "Creator economics"],
    ],
  },
  {
    label: "Application",
    sections: [
      ["swap", "Swap"],
      ["funds", "Funds and identity"],
      ["liquidity", "External liquidity"],
      ["availability", "Availability"],
    ],
  },
] as const;

export default function DocsPage() {
  return (
    <main className="docsPage">
      <header className="docsHeader">
        <Link className="docsBrand" href="/"><span>OTF</span><strong>Onchain Traded Funds</strong></Link>
        <div className="docsHeaderActions"><Link href="/">Open Swap <ArrowUpRight size={14} /></Link><Link href="/create">Create OTF</Link></div>
      </header>
      <div className="docsLayout">
        <DocsNavigation groups={groups} />
        <article className="docsContent">
          <header className="docsIntro">
            <h1>Protocol documentation</h1>
            <p>OTFs are formed from a signed market-cap snapshot. The formation decision is fixed at creation.</p>
          </header>

          <section id="formation" className="docsSection">
            <h2>Formation uses an authenticated snapshot</h2>
            <p>An authority signs the formation data for the chosen chain, factory, and intended creator. The signature binds the ordered constituent addresses and expected token decimals, market caps, unit prices, snapshot time and expiry, calculation version, and nonce.</p>
            <div className="docsCallout">
              <strong>There is no ongoing price oracle, Net Asset Value calculation, rebalance, strategy, proposal, challenge, target-weight system, or adapter approval process.</strong>
              <p>Those mechanisms do not exist in this design. A fund’s formation inputs are not a continuing trading instruction.</p>
            </div>
          </section>

          <section id="creation" className="docsSection">
            <h2>What a creator supplies</h2>
            <p>The creator supplies only ordinary metadata, an ordered list of up to 20 constituent token addresses, a fixed beneficiary, and an immutable annual creator expense ratio from 0 to 1000 basis points. The application rejects duplicate addresses.</p>
            <ol className="docsSteps">
              <li><span>1</span><div><strong>Enter metadata and ordered addresses</strong><p>Addresses determine order only; the form never asks the creator to set allocations or prices.</p></div></li>
              <li><span>2</span><div><strong>Set immutable economics</strong><p>The beneficiary and annual creator expense ratio are fixed when formation is eventually submitted.</p></div></li>
              <li><span>3</span><div><strong>Use a valid, unexpired snapshot</strong><p>A typed snapshot/create service must validate the signed payload before a transaction can be prepared.</p></div></li>
            </ol>
          </section>

          <section id="fees" className="docsSection">
            <h2>Creator economics and dilution</h2>
            <p>The annual creator expense ratio is immutable and may be set no higher than 10%. Ten percent is the protocol maximum and is not recommended.</p>
            <div className="docsCallout warning">
              <strong>Expense shares can dilute holders.</strong>
              <p>The formation-allocation rebate benefits the creator and does not reduce the holder fee. Its value can remain high if the OTF’s value later falls.</p>
            </div>
          </section>

          <section id="swap" className="docsSection">
            <h2>Swap quotes are limited and explicit</h2>
            <p>The Swap screen can request a direct-liquidity route and a basket-settlement route concurrently. It compares only usable results from those two queries; it never claims a globally optimal price.</p>
            <p>Address paste is selection only. An address remains unresolved until metadata and route support are independently available. Verification does not gate address routing.</p>
            <div className="docsCallout">
              <strong>No endpoint, no transaction.</strong>
              <p>Without a typed quote service, the application shows unavailable states. It does not invent quotes, approvals, simulations, or submitted transactions. Router ABI arguments are derived locally from validated typed responses.</p>
            </div>
          </section>

          <section id="funds" className="docsSection">
            <h2>Funds and identity</h2>
            <p>Fund detail pages remain address-routed, including historic URLs. A directory or detail reader must use the new factory interface and a typed index/read service before presenting onchain rows or history.</p>
            <p>“Verified” establishes identity and ordinary metadata only. It does not establish a pool, route, liquidity, price, economics, audit status, or investment outcome.</p>
          </section>

          <section id="liquidity" className="docsSection">
            <h2>External liquidity stays external</h2>
            <p>Liquidity links are enabled only for a selected OTF/USDG pair on a trusted network configuration. They open in a new tab and never submit a liquidity action from OTF.</p>
            <ul className="docsChecklist">
              <li>Robinhood Chain will use the configured Uniswap position link with selected token addresses once a trusted USDG address is published.</li>
              <li>Robinhood Chain Testnet opens Synthra without prefill because no documented OTF/USDG pair-prefill URL is published.</li>
              <li>No link implies an official pool.</li>
            </ul>
          </section>

          <section id="availability" className="docsSection">
            <h2>Current availability</h2>
            <p>The new contracts, typed snapshot/create service, typed quote service, and factory directory/history reader still need configuration. Until then, executable writes stay disabled and each unavailable state names that limitation.</p>
            <div className="docsNext"><div><strong>Use the application surface</strong><span>Review the unavailable states and formation input requirements directly in the app.</span></div><Link href="/">Open Swap <ExternalLink size={14} /></Link></div>
          </section>
        </article>
      </div>
    </main>
  );
}
