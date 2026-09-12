"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { OtfTokenIcon } from "@onchaintradedfunds/brand";
import { estimatedRewardsApy, OTF_REWARDS_APY_CAP_PERCENT } from "@/lib/incentive-apy";

type Props = {
  fundName: string;
  symbol: string;
  apyText: string;
  error?: string;
  hasOtf?: boolean;
  zeroNav: boolean;
  loading: boolean;
  navUsd?: number;
  otfPriceUsd?: number;
  fundWeightOtf?: number;
  totalWeightOtf?: number;
  weeklyDepositorEmissionOtf?: number;
  week?: number;
  onClose: () => void;
};

function tokens(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en", { notation: value >= 10_000 ? "compact" : "standard", maximumFractionDigits: 2 });
}

function dollars(value: number | undefined, maximumFractionDigits = 2) {
  if (value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en", { style: "currency", currency: "USD", maximumFractionDigits });
}

export function FundRewardsDialog(props: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const dialog = dialogRef.current!;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const weight = props.hasOtf === false ? 0 : props.fundWeightOtf;
  const share = weight === 0 ? 0 : weight !== undefined && props.totalWeightOtf !== undefined && props.totalWeightOtf > 0
    ? weight / props.totalWeightOtf : undefined;
  const shareText = share === undefined ? "—" : `${(share * 100).toLocaleString("en", { maximumFractionDigits: 2 })}%`;
  const estimate = props.loading || props.error ? undefined : estimatedRewardsApy({
    weeklyDepositorEmissionOtf: props.weeklyDepositorEmissionOtf ?? NaN,
    otfPriceUsd: props.otfPriceUsd ?? NaN,
    fundAumUsd: props.zeroNav ? 0 : props.navUsd ?? NaN,
    fundRewardWeightOtf: weight ?? NaN,
    totalRewardWeightOtf: props.totalWeightOtf ?? NaN,
  });
  const weeklyTokens = estimate?.weeklyRewardOtf;
  const weeklyUsd = estimate?.weeklyRewardUsd;
  const maximumApy = `${OTF_REWARDS_APY_CAP_PERCENT.toLocaleString("en")}%`;
  const reason = props.hasOtf === false
    ? "This fund does not include the OTF token, so it receives no share of the depositor rewards pool."
    : props.zeroNav
    ? "This fund's NAV is zero. Its APY stays at 0% until it has positive NAV and holds OTF."
    : weight === 0
    ? "This fund currently holds no OTF through deposits, so its reward weight is zero."
    : props.loading
    ? "The estimate is loading fund balances and current prices."
    : props.error
    ? props.error
    : props.apyText === "—"
    ? "Some balances or prices are unavailable, so this fund's APY cannot be calculated yet."
    : estimate?.capped
    ? `This fund reaches the ${maximumApy} rewards APY maximum. Its weekly depositor rewards are reduced, and excess OTF stays unallocated.`
    : `This fund's weight gives it ${shareText} of the depositor budget before the APY cap. Its APY compares the dollar value of its rewards with its NAV.`;

  return createPortal(
    <dialog
      ref={dialogRef}
      className="rewardsDialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => { event.preventDefault(); props.onClose(); }}
      onClick={(event) => { event.stopPropagation(); if (event.target === event.currentTarget) props.onClose(); }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div className="rewardsDialogContent">
        <header className="rewardsDialogHeader">
          <OtfTokenIcon size={36} ticker={props.symbol} />
          <div><h2 id={titleId}>Rewards APY</h2><p>{props.fundName}</p></div>
          <button type="button" className="rewardsDialogClose" aria-label="Close rewards explanation" onClick={props.onClose}><X size={18} aria-hidden="true" /></button>
        </header>
        <div className="rewardsDialogBody">
          <p id={descriptionId} className="rewardsDialogReason">{reason}</p>
          <dl className="rewardsCalculation">
            <div><dt>OTF counted toward rewards<small>Fund holdings, capped at 10M OTF</small></dt><dd>{tokens(weight)} <span>OTF</span></dd></div>
            <div><dt>Weight-based share<small>{weight === 0 ? "No eligible OTF means no share of the pool" : `${tokens(weight)} ÷ ${tokens(props.totalWeightOtf)} eligible OTF across funds, before the APY cap`}</small></dt><dd>{shareText}</dd></div>
            <div><dt>Estimated weekly depositor rewards<small>{props.zeroNav || share === 0 ? "Zero NAV or reward weight means no weekly allocation" : estimate?.capped ? `Reduced to the ${maximumApy} APY limit` : `${tokens(props.weeklyDepositorEmissionOtf)} OTF budget in ${props.week ? `week ${props.week}` : "this week"} × ${shareText}`}</small></dt><dd>{tokens(weeklyTokens)} <span>OTF</span></dd></div>
          </dl>
          <dl className="rewardsValuationInputs">
            <div><dt>Fund NAV</dt><dd>{dollars(props.navUsd)}</dd></div>
            <div><dt>OTF price</dt><dd>{dollars(props.otfPriceUsd, 6)}</dd></div>
          </dl>
          <div className="rewardsApyResult">
            <div><span>Estimated annual return</span><strong>{props.apyText}</strong></div>
            <p>{maximumApy} maximum. Excess rewards stay unallocated without redistribution or automatic rollover.</p>
            {props.zeroNav || weight === 0 ? <p>Zero NAV or zero OTF weight means 0% APY.</p> : <>
              <p>Weekly rewards in USD × 52 ÷ fund NAV × 100</p>
              <small>({dollars(weeklyUsd)} × 52) ÷ {dollars(props.navUsd)} × 100</small>
            </>}
          </div>
          <p className="rewardsDialogNote">This estimate uses current prices and projects one week over 52 weeks without compounding. Published rewards use snapshot NAV and the OTF USD price selected by the publisher for that week. Later price changes can change realized returns. Displayed figures are rounded.</p>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
