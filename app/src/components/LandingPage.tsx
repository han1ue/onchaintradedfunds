"use client";

import {
  ArrowRight,
  BookOpen,
  Boxes,
  CheckCircle,
  History,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { ETFChainScene } from "./ETFChainScene";

type LandingPageProps = {
  onCreate: () => void;
  onEnter: () => void;
};

function LandingBrand() {
  return (
    <span className="landingBrand">
      <span>OTF</span>
      <strong>Onchain Traded Funds</strong>
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
          <a href="/docs">Docs</a>
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
              One OTF holds a diversified portfolio. Its assets, weights, valuation, and every
              successful rebalance advance together as verifiable onchain state.
            </p>
            <p className="landingStatus">Robinhood Testnet preview · experimental, unaudited software</p>
            <div className="landingActions">
              <button className="landingPrimary" type="button" onClick={onEnter}>
                Explore OTFs
                <ArrowRight size={15} />
              </button>
              <button className="landingSecondary" type="button" onClick={onCreate}>
                Create an OTF
              </button>
            </div>
            <div className="landingProof">
              <span><strong>Known assets</strong><small>approved universe</small></span>
              <span><strong>Live weights</strong><small>oracle priced</small></span>
              <span><strong>Atomic</strong><small>portfolio changes</small></span>
            </div>
          </div>
          <a className="landingScrollCue" href="#architecture">
            <span />
            <span>
              <small>Follow the portfolio</small>
              <strong>Watch weights evolve</strong>
            </span>
          </a>
        </section>

        <section className="landingStory" id="architecture">
          <div className="landingStoryCopy">
            <span className="landingChapter">01 / The basket</span>
            <Boxes size={22} />
            <h2>Known assets.<br />One portfolio.</h2>
            <p>
              TSLA, AMZN, and AMD can sit behind one OTF share. Each constituent keeps its
              identity while its allocation remains explicit and publicly inspectable.
            </p>
            <div className="landingFactList">
              <span><CheckCircle size={13} /> Approved assets only</span>
              <span><CheckCircle size={13} /> Public target and actual weights</span>
              <span><CheckCircle size={13} /> Oracle-priced balances</span>
            </div>
          </div>
        </section>

        <section className="landingStory" id="ownership">
          <div className="landingStoryCopy">
            <span className="landingChapter">02 / Each state</span>
            <History size={22} />
            <h2>Weights move<br />block by block.</h2>
            <p>
              The same assets settle onto each new portfolio state. Their relative size changes
              with the fund allocation, while earlier versions remain visible in its history.
            </p>
            <div className="landingFactList">
              <span><CheckCircle size={13} /> Asset identity persists</span>
              <span><CheckCircle size={13} /> Allocation weights can change</span>
              <span><CheckCircle size={13} /> Previous states are never overwritten</span>
            </div>
          </div>
        </section>

        <section className="landingStory" id="supply">
          <div className="landingStoryCopy">
            <span className="landingChapter">03 / The rebalance</span>
            <RefreshCw size={22} />
            <h2>The mix can<br />evolve.</h2>
            <p>
              A manager can propose new target weights as the thesis evolves. The portfolio only
              advances when every trade executes and every final safety check passes.
            </p>
            <div className="landingFactList">
              <span><CheckCircle size={13} /> Maximum turnover enforced</span>
              <span><CheckCircle size={13} /> Approved adapters only</span>
              <span><CheckCircle size={13} /> Atomic execution or full rollback</span>
            </div>
          </div>
        </section>

        <section className="landingStory" id="portfolio">
          <div className="landingStoryCopy">
            <span className="landingChapter">04 / The bounds</span>
            <ShieldCheck size={22} />
            <h2>Only valid states<br />persist.</h2>
            <p>
              The contract bounds portfolio risk before a new allocation can become state.
              Failed rebalances leave the prior portfolio and its cooldown untouched.
            </p>
            <div className="landingBigStat">
              <strong>7 days</strong>
              <span>Minimum cooldown between successful portfolio changes</span>
            </div>
            <div className="landingFactList">
              <span><CheckCircle size={13} /> Fresh onchain prices required</span>
              <span><CheckCircle size={13} /> Weight and NAV-loss limits enforced</span>
              <span><CheckCircle size={13} /> Failed rebalances change nothing</span>
            </div>
          </div>
        </section>

        <section className="landingFinal" id="enter">
          <span className="landingChapter">The onchain fund</span>
          <h2>One portfolio.<br />Every version visible.</h2>
          <p>
            Constituents, weights, valuation, mandate, and portfolio history remain legible from
            one onchain structure.
          </p>
          <div className="landingActions">
            <button className="landingPrimary" type="button" onClick={onEnter}>
              Enter the app
              <ArrowRight size={15} />
            </button>
            <a className="landingSecondary" href="/docs">
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
