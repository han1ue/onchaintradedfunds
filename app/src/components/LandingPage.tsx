"use client";

import {
  ArrowRight,
  BookOpen,
  Boxes,
  CheckCircle,
  ExternalLink,
  History,
  TrendingUp,
  Wallet,
  Zap,
} from "lucide-react";
import { ETFChainScene } from "./ETFChainScene";

type LandingPageProps = {
  onCreate: () => void;
  onEnter: () => void;
};

function LandingBrand() {
  return (
    <span className="landingBrand">
      <span><TrendingUp size={16} /></span>
      <span>
        <strong>Onchain Traded Funds</strong>
        <small>OTF protocol</small>
      </span>
    </span>
  );
}

export function LandingPage({ onCreate, onEnter }: LandingPageProps) {
  return (
    <div className="landingPage">
      <ETFChainScene />

      <header className="landingNav">
        <LandingBrand />
        <nav aria-label="Landing navigation">
          <a href="#architecture">Fund model</a>
          <a href="#portfolio">Controls</a>
          <a href="https://github.com/han1ue/onchaintradedfunds#readme" target="_blank" rel="noreferrer">
            Docs
            <ExternalLink size={11} />
          </a>
        </nav>
        <button type="button" onClick={onEnter}>
          Enter app
          <ArrowRight size={14} />
        </button>
      </header>

      <main className="landingMain">
        <section className="landingHero">
          <div className="landingHeroCopy">
            <p className="landingKicker">A familiar fund structure, expressed as onchain state</p>
            <h1>Onchain Traded Funds</h1>
            <p className="landingThesis">The ETF idea,<br />rebuilt onchain.</p>
            <p className="landingIntro">
              One vault holds the portfolio. Its ownership, share supply, valuation, and every
              successful portfolio change advance together, block by block.
            </p>
            <div className="landingActions">
              <button className="landingPrimary" type="button" onClick={onEnter}>
                Explore vaults
                <ArrowRight size={15} />
              </button>
              <button className="landingSecondary" type="button" onClick={onCreate}>
                Create a vault
              </button>
            </div>
            <div className="landingProof">
              <span><strong>One vault</strong><small>successive states</small></span>
              <span><strong>Variable</strong><small>share supply</small></span>
              <span><strong>Recorded</strong><small>block by block</small></span>
            </div>
          </div>
          <a className="landingScrollCue" href="#architecture">
            <span />
            <span>
              <small>Follow the fund</small>
              <strong>Into the ledger</strong>
            </span>
          </a>
        </section>

        <section className="landingStory" id="architecture">
          <div className="landingStoryCopy">
            <span className="landingChapter">01 / The first block</span>
            <Boxes size={22} />
            <h2>The fund becomes<br />state.</h2>
            <p>
              The portfolio and its ownership settle into one contract state. Assets, weights,
              balances, valuation, and total share supply can be inspected together.
            </p>
            <div className="landingFactList">
              <span><CheckCircle size={13} /> Vault holds the underlying basket</span>
              <span><CheckCircle size={13} /> ERC-4626 represents ownership</span>
              <span><CheckCircle size={13} /> Portfolio state is publicly readable</span>
            </div>
          </div>
        </section>

        <section className="landingStory" id="ownership">
          <div className="landingStoryCopy">
            <span className="landingChapter">02 / The next block</span>
            <Wallet size={22} />
            <h2>Shares move with<br />the ledger.</h2>
            <p>
              Each confirmed state carries fund ownership forward. Deposits mint new claims,
              redemptions burn them, and balances persist as the chain advances.
            </p>
            <div className="landingFactList">
              <span><CheckCircle size={13} /> Deposits mint proportional shares</span>
              <span><CheckCircle size={13} /> Redemptions burn shares</span>
              <span><CheckCircle size={13} /> Ownership survives every state transition</span>
            </div>
          </div>
        </section>

        <section className="landingStory" id="supply">
          <div className="landingStoryCopy">
            <span className="landingChapter">03 / The supply</span>
            <History size={22} />
            <h2>Supply changes<br />in public.</h2>
            <p>
              The number of shares can rise or fall while the fund remains the same vault.
              Every block records the resulting supply and the ownership it represents.
            </p>
            <div className="landingFactList">
              <span><CheckCircle size={13} /> Deposits increase total supply</span>
              <span><CheckCircle size={13} /> Redemptions reduce total supply</span>
              <span><CheckCircle size={13} /> Accrued fees mint recipient shares</span>
            </div>
          </div>
        </section>

        <section className="landingStory" id="portfolio">
          <div className="landingStoryCopy">
            <span className="landingChapter">04 / The portfolio</span>
            <Zap size={22} />
            <h2>Every change is<br />recorded.</h2>
            <p>
              A rebalance becomes the next valid fund state only after its trades execute and
              every safety check passes. A failed transaction leaves both state and cooldown intact.
            </p>
            <div className="landingBigStat">
              <strong>7 days</strong>
              <span>Minimum cooldown between successful portfolio changes</span>
            </div>
            <div className="landingFactList">
              <span><CheckCircle size={13} /> Approved, atomic execution</span>
              <span><CheckCircle size={13} /> Portfolio history remains inspectable</span>
              <span><CheckCircle size={13} /> Failed rebalances change nothing</span>
            </div>
          </div>
        </section>

        <section className="landingFinal" id="enter">
          <span className="landingChapter">The onchain fund</span>
          <h2>One fund.<br />Every state visible.</h2>
          <p>
            The basket, ownership, share supply, mandate, valuation, and portfolio history remain
            legible from one onchain structure.
          </p>
          <div className="landingActions">
            <button className="landingPrimary" type="button" onClick={onEnter}>
              Enter the app
              <ArrowRight size={15} />
            </button>
            <a className="landingSecondary" href="https://github.com/han1ue/onchaintradedfunds#readme" target="_blank" rel="noreferrer">
              <BookOpen size={14} />
              Read the docs
            </a>
          </div>
          <footer>
            <LandingBrand />
            <span>Experimental, unaudited software · Robinhood Testnet</span>
          </footer>
        </section>
      </main>
    </div>
  );
}
