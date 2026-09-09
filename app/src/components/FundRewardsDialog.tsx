"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { OtfTokenIcon } from "@onchaintradedfunds/brand";

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
  const weeklyTokens = share === 0 ? 0 : share !== undefined && props.weeklyDepositorEmissionOtf !== undefined
    ? props.weeklyDepositorEmissionOtf * share : undefined;
  const weeklyUsd = weeklyTokens === 0 ? 0 : weeklyTokens !== undefined && props.otfPriceUsd !== undefined
    ? weeklyTokens * props.otfPriceUsd : undefined;
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
    : `This fund receives ${shareText} of the depositor pool. Its APY compares the dollar value of those rewards with its NAV.`;

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
          <p className="rewardsDialogRule">Only OTF held through fund deposits counts. Each fund&apos;s weight is capped at <strong>10M OTF</strong>; any excess adds no reward share. This APY uses the depositor pool; creator rewards are separate.</p>
          <dl className="rewardsCalculation">
            <div><dt>OTF counted toward rewards<small>Fund holdings, capped at 10M OTF</small></dt><dd>{tokens(weight)} <span>OTF</span></dd></div>
            <div><dt>Share of the pool<small>{weight === 0 ? "No eligible OTF means no share of the pool" : `${tokens(weight)} ÷ ${tokens(props.totalWeightOtf)} eligible OTF across funds`}</small></dt><dd>{shareText}</dd></div>
            <div><dt>Weekly depositor rewards<small>{share === 0 ? "Zero reward weight means no weekly allocation" : `${tokens(props.weeklyDepositorEmissionOtf)} OTF in ${props.week ? `week ${props.week}` : "this week's pool"} × ${shareText}`}</small></dt><dd>{tokens(weeklyTokens)} <span>OTF</span></dd></div>
          </dl>
          <dl className="rewardsValuationInputs">
            <div><dt>Fund NAV</dt><dd>{dollars(props.navUsd)}</dd></div>
            <div><dt>OTF price</dt><dd>{dollars(props.otfPriceUsd, 6)}</dd></div>
          </dl>
          <div className="rewardsApyResult">
            <div><span>Estimated annual return</span><strong>{props.apyText}</strong></div>
            {props.zeroNav || weight === 0 ? <p>Zero NAV or zero OTF weight means 0% APY.</p> : <>
              <p>Weekly rewards in USD × 52 ÷ fund NAV × 100</p>
              <small>({dollars(weeklyUsd)} × 52) ÷ {dollars(props.navUsd)} × 100</small>
            </>}
          </div>
          <p className="rewardsDialogNote">Rewards are paid in protocol $OTF. APY projects one week over a year; actual returns change with emissions, fund balances and token prices. Displayed figures are rounded.</p>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
