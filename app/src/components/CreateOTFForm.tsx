"use client";

import { useConnectModal } from "@rainbow-me/rainbowkit";
import { otfFactoryAbi } from "@onchaintradedfunds/generated";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle,
  CircleAlert,
  FilePlus2,
  LoaderCircle,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { getAddress, isAddress, parseEventLogs, zeroAddress, type Address, type Hex } from "viem";
import { useAccount, useChainId, usePublicClient, useWalletClient } from "wagmi";
import { robinhoodChainTestnet } from "@/lib/chains";
import {
  robinhoodTestnetAddresses,
  robinhoodTestnetCreationReady,
} from "@/lib/deployment";
import {
  PERCENT_DECIMALS,
  TOTAL_PERCENT_UNITS,
  calculateBootstrapBasketUnits,
  formatPercentageDisplay,
  formatPercentageExact,
  formatPercentageInput,
  percentageUnits,
  percentageUnitsForSelectionChange,
  previewBootstrapBasketUnits,
  resetToMarketCapPercentageUnits,
  submitAndConfirmCreation,
  zeroRawUnitError,
  type BasketCalculation,
  type CreationAssetData,
} from "@/lib/creation-model";
import {
  buildCreationMetadataDraft,
  formatMarketCapMultiplier,
  formatMarketCapSnapshotTimestamp,
  persistCreationMetadata,
  weightingMethodLabel,
  type OtfCreationMetadataDraft,
} from "@/lib/creation-metadata";

type SelectedAsset = CreationAssetData & {
  percentageInput: string;
  percentageUnits: bigint;
};
type SubmissionState = "idle" | "submitting" | "success" | "failure" | "unknown";
type SubmittedSnapshot = {
  name: string;
  symbol: string;
  annualExpenseRatioBps: number;
  creator: Address;
  selectedAssets: SelectedAsset[];
  calculation: BasketCalculation;
  creationMetadata: OtfCreationMetadataDraft;
};

const MAX_MANDATE_BYTES = 2_048;

const steps = [
  { label: "Identity", description: "Name and application metadata" },
  { label: "Constituents", description: "Assets and weights" },
  { label: "Economics", description: "Fee and beneficiary" },
  { label: "Review", description: "Raw immutable bootstrap units" },
] as const;

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function fixedInput(value: string, decimals: number): string | undefined {
  const normalized = value.replace(/,/gu, "");
  if (!new RegExp(`^\\d*(?:\\.\\d{0,${decimals}})?$`, "u").test(normalized)) return undefined;
  return normalized;
}

function creationAsset(value: unknown): CreationAssetData | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const asset = value as Record<string, unknown>;
  if (
    typeof asset.address !== "string" || !isAddress(asset.address)
    || typeof asset.symbol !== "string" || typeof asset.name !== "string"
    || typeof asset.priceUsd !== "string" || typeof asset.marketCapUsd !== "string"
    || !Number.isInteger(asset.decimals)
  ) return undefined;
  return {
    address: getAddress(asset.address),
    symbol: asset.symbol,
    name: asset.name,
    decimals: Number(asset.decimals),
    priceUsd: asset.priceUsd,
    marketCapUsd: asset.marketCapUsd,
    priceUpdatedAt: typeof asset.priceUpdatedAt === "string" ? asset.priceUpdatedAt : undefined,
    verified: asset.verified === true,
  };
}

function applyMarketCapDefaults(assets: readonly CreationAssetData[]): SelectedAsset[] {
  if (!assets.length) return [];
  const percentages = resetToMarketCapPercentageUnits(assets.map((asset) => asset.marketCapUsd));
  return assets.map((asset, index) => ({
    ...asset,
    percentageInput: formatPercentageExact(percentages[index]),
    percentageUnits: percentages[index],
  }));
}

function preserveSelectionPercentages(
  current: readonly SelectedAsset[],
  next: readonly CreationAssetData[],
): SelectedAsset[] {
  const percentages = percentageUnitsForSelectionChange(
    current.map((asset) => ({ key: asset.address, percentageUnits: asset.percentageUnits })),
    next.map((asset) => ({ key: asset.address, marketCapUsd: asset.marketCapUsd })),
  );
  return next.map((asset, index) => {
    const existing = current.find((candidate) => candidate.address === asset.address);
    return existing ?? {
      ...asset,
      percentageInput: formatPercentageExact(percentages[index]),
      percentageUnits: percentages[index],
    };
  });
}

export function CreateOTFForm({ returnHref }: { returnHref: string }) {
  const chainId = useChainId();
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient({ chainId });
  const { openConnectModal } = useConnectModal();
  const [step, setStep] = useState(0);
  const [furthestStep, setFurthestStep] = useState(0);
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [mandate, setMandate] = useState("");
  const [expenseRatio, setExpenseRatio] = useState("0");
  const [beneficiary, setBeneficiary] = useState("");
  const [availableAssets, setAvailableAssets] = useState<CreationAssetData[]>([]);
  const [selectedAssets, setSelectedAssets] = useState<SelectedAsset[]>([]);
  const [assetLoadState, setAssetLoadState] = useState<"loading" | "ready" | "empty" | "failure">("loading");
  const [submission, setSubmission] = useState<SubmissionState>("idle");
  const [submissionMessage, setSubmissionMessage] = useState<string>();
  const [transactionHash, setTransactionHash] = useState<Hex>();
  const [createdVaultAddress, setCreatedVaultAddress] = useState<Address>();
  const [submittedSnapshot, setSubmittedSnapshot] = useState<SubmittedSnapshot>();
  const [marketCapSnapshotAt, setMarketCapSnapshotAt] = useState<string>();
  const [focusedPercentage, setFocusedPercentage] = useState<Address>();
  const creationLocked = submission === "submitting" || submission === "success" || submission === "unknown";

  useEffect(() => {
    if (address && !beneficiary) setBeneficiary(address);
  }, [address, beneficiary]);

  useEffect(() => {
    const controller = new AbortController();
    setAssetLoadState("loading");
    setAvailableAssets([]);
    setSelectedAssets([]);
    setMarketCapSnapshotAt(undefined);
    void fetch(`/api/creation-assets?chainId=${chainId}`, {
      cache: "no-store",
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error("ASSET_DATA_UNAVAILABLE");
      const payload = await response.json() as { data?: unknown[]; marketCapSnapshotAt?: unknown };
      if (
        typeof payload.marketCapSnapshotAt !== "string"
        || !Number.isFinite(Date.parse(payload.marketCapSnapshotAt))
      ) throw new Error("MARKET_CAP_SNAPSHOT_UNAVAILABLE");
      const assets = (payload.data ?? []).flatMap((value) => {
        const parsed = creationAsset(value);
        return parsed ? [parsed] : [];
      });
      if (controller.signal.aborted) return;
      setAvailableAssets(assets);
      const initial = applyMarketCapDefaults(assets.slice(0, 1));
      setSelectedAssets(initial);
      setMarketCapSnapshotAt(new Date(payload.marketCapSnapshotAt).toISOString());
      setAssetLoadState(assets.length ? "ready" : "empty");
    }).catch(() => {
      if (!controller.signal.aborted) setAssetLoadState("failure");
    });
    return () => controller.abort();
  }, [chainId]);

  const mandateBytes = new TextEncoder().encode(mandate.trim()).length;
  const normalizedName = name.trim();
  const nameValid = normalizedName.length > 4 && normalizedName.endsWith(" OTF");
  const symbolValid = /^[A-Z0-9][A-Z0-9-]*$/u.test(symbol);
  const identityValid = nameValid && symbolValid && mandateBytes > 0
    && mandateBytes <= MAX_MANDATE_BYTES;
  const totalPercentage = selectedAssets.reduce((sum, asset) => sum + asset.percentageUnits, 0n);
  const positivePercentages = selectedAssets.every((asset) => asset.percentageUnits > 0n);
  const percentagesValid = positivePercentages && totalPercentage === TOTAL_PERCENT_UNITS;
  const calculationAssets = useMemo(() => selectedAssets.map((asset) => ({
    symbol: asset.symbol,
    decimals: asset.decimals,
    percentageUnits: asset.percentageUnits,
    priceUsd: asset.priceUsd,
  })), [selectedAssets]);
  const previewRowsResult = useMemo(() => {
    try {
      return { value: previewBootstrapBasketUnits(calculationAssets) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Basket preview failed." };
    }
  }, [calculationAssets]);
  const previewRows = previewRowsResult.value;
  const assetErrors = calculationAssets.map((asset, index) => {
    if (asset.percentageUnits <= 0n) return `${asset.symbol} must have a percentage greater than 0%.`;
    const row = previewRows?.[index];
    return row ? zeroRawUnitError(asset, row) : undefined;
  });
  const calculationResult = useMemo(() => {
    try {
      return { value: calculateBootstrapBasketUnits(calculationAssets) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Basket calculation failed." };
    }
  }, [calculationAssets]);
  const calculation = calculationResult.value;
  const creationMetadataResult = useMemo(() => {
    if (!marketCapSnapshotAt) return { error: "Market-cap snapshot timestamp is unavailable." };
    try {
      return { value: buildCreationMetadataDraft({
        marketCapSnapshotAt,
        assets: selectedAssets.map((asset) => ({
          address: asset.address,
          symbol: asset.symbol,
          name: asset.name,
          marketCapUsd: asset.marketCapUsd,
          finalPercentageUnits: asset.percentageUnits,
        })),
      }) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Creation metadata is invalid." };
    }
  }, [marketCapSnapshotAt, selectedAssets]);
  const creationMetadata = creationMetadataResult.value;
  const basketGlobalError = previewRowsResult.error
    ?? (assetErrors.some(Boolean) ? undefined : calculationResult.error ?? creationMetadataResult.error);
  const basketValid = selectedAssets.length > 0 && selectedAssets.length <= 20
    && percentagesValid && !assetErrors.some(Boolean) && Boolean(calculation && creationMetadata);
  const annualExpenseRatioBps = /^\d+$/u.test(expenseRatio) ? Number(expenseRatio) : Number.NaN;
  const economicsValid = Number.isInteger(annualExpenseRatioBps)
    && annualExpenseRatioBps >= 0 && annualExpenseRatioBps <= 1_000
    && isAddress(beneficiary) && beneficiary.toLowerCase() !== zeroAddress;
  const stepValid = [identityValid, basketValid, economicsValid, true];
  const remainingAssets = availableAssets.filter((candidate) => (
    !selectedAssets.some((selected) => selected.address.toLowerCase() === candidate.address.toLowerCase())
  ));
  const deploymentReady = chainId === robinhoodChainTestnet.id
    && robinhoodTestnetCreationReady && Boolean(robinhoodTestnetAddresses.factory);
  const submitDisabled = !deploymentReady || creationLocked
    || (Boolean(address) && (!calculation || !identityValid || !basketValid || !economicsValid));
  const reviewSnapshot = creationLocked && submittedSnapshot ? submittedSnapshot : {
    name: normalizedName,
    symbol,
    annualExpenseRatioBps,
    creator: address,
    selectedAssets,
    calculation,
    creationMetadata,
  };

  function resetSubmission() {
    setSubmission("idle");
    setSubmissionMessage(undefined);
    setTransactionHash(undefined);
    setCreatedVaultAddress(undefined);
    setSubmittedSnapshot(undefined);
  }

  function addAsset(addressValue: string) {
    const asset = availableAssets.find((candidate) => candidate.address === addressValue);
    if (!asset || selectedAssets.length >= 20) return;
    setSelectedAssets((current) => preserveSelectionPercentages(current, [...current, asset]));
    resetSubmission();
  }

  function replaceAsset(addressValue: Address, nextAddressValue: string) {
    const replacement = availableAssets.find((candidate) => candidate.address === nextAddressValue);
    if (!replacement) return;
    setSelectedAssets((current) => current.map((asset) => (
      asset.address === addressValue
        ? { ...replacement, percentageInput: asset.percentageInput, percentageUnits: asset.percentageUnits }
        : asset
    )));
    resetSubmission();
  }

  function removeAsset(addressValue: Address) {
    setSelectedAssets((current) => current.filter((asset) => asset.address !== addressValue));
    resetSubmission();
  }

  function resetMarketCapWeights() {
    setSelectedAssets((current) => applyMarketCapDefaults(current));
    resetSubmission();
  }

  function editPercentage(addressValue: Address, value: string) {
    const next = fixedInput(value, PERCENT_DECIMALS);
    if (next === undefined) return;
    const units = percentageUnits(next) ?? 0n;
    setSelectedAssets((current) => current.map((asset) => (
      asset.address === addressValue
        ? { ...asset, percentageInput: next, percentageUnits: units }
        : asset
    )));
    resetSubmission();
  }

  function continueToNextStep() {
    if (!stepValid[step]) return;
    setFurthestStep((current) => Math.max(current, step + 1));
    setStep((current) => current + 1);
  }

  async function submitCreation() {
    if (!address) {
      openConnectModal?.();
      return;
    }
    const factory = robinhoodTestnetAddresses.factory;
    if (
      !calculation || !creationMetadata || !identityValid || !basketValid || !economicsValid
      || !deploymentReady || !walletClient || !publicClient || !factory
    ) return;
    setSubmittedSnapshot({
      name: normalizedName,
      symbol,
      annualExpenseRatioBps,
      creator: address,
      selectedAssets: selectedAssets.map((asset) => ({ ...asset })),
      calculation,
      creationMetadata,
    });
    setSubmission("submitting");
    setSubmissionMessage("Confirm the empty OTF creation transaction in your wallet.");
    setTransactionHash(undefined);
    let confirmedVaultAddress: Address | undefined;
    const outcome = await submitAndConfirmCreation({
      write: async () => {
        const hash = await walletClient.writeContract({
          address: factory,
          abi: otfFactoryAbi,
          functionName: "createVault",
          args: [{
            name: normalizedName,
            symbol,
            expenseBeneficiary: getAddress(beneficiary),
            annualCreatorExpenseRatioBps: annualExpenseRatioBps,
            constituents: selectedAssets.map((asset) => asset.address),
            bootstrapBasketUnitsPerOTF: calculation.bootstrapBasketUnitsPerOTF,
          }],
        });
        if (!hash) throw new Error("The wallet did not return a transaction hash.");
        return hash;
      },
      onBroadcast: (hash) => {
        setTransactionHash(hash);
        setSubmissionMessage("Creation submitted. Waiting for onchain confirmation.");
      },
      waitForReceipt: async (hash) => {
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status === "success") {
          const event = parseEventLogs({
            abi: otfFactoryAbi,
            eventName: "VaultCreated",
            logs: receipt.logs,
            strict: true,
          })[0];
          confirmedVaultAddress = event?.args.vault;
        }
        return receipt.status;
      },
    });
    if (outcome.status === "failure" && outcome.phase === "write") {
      setSubmission("failure");
      setSubmissionMessage(outcome.message);
      return;
    }
    if (outcome.status === "success") {
      setSubmission("success");
      if (!confirmedVaultAddress) {
        setSubmissionMessage("OTF created, but its application metadata could not be associated because the creation event was unavailable.");
        return;
      }
      setCreatedVaultAddress(confirmedVaultAddress);
      try {
        persistCreationMetadata(window.localStorage, chainId, confirmedVaultAddress, creationMetadata);
        setSubmissionMessage("OTF created empty. Its informational creation methodology is stored in this browser.");
      } catch {
        setSubmissionMessage("OTF created, but its informational creation methodology could not be stored in this browser.");
      }
      return;
    }
    if (outcome.status === "failure") {
      setSubmission("failure");
      setSubmissionMessage("Creation transaction reverted onchain.");
      return;
    }
    setSubmission("unknown");
    setSubmissionMessage("The transaction was submitted, but its confirmation could not be verified. Check the explorer before taking any further action.");
  }

  return (
    <div className="createLayout">
      <aside className="createSteps" aria-label="OTF creation progress">
        {steps.map((item, index) => (
          <button
            className={`${step === index ? "active" : ""} ${index < step || submission === "success" ? "complete" : ""}`}
            key={item.label}
            type="button"
            disabled={index > furthestStep || creationLocked}
            aria-current={step === index ? "step" : undefined}
            onClick={() => setStep(index)}
          >
            <span>{index < step || submission === "success" ? <Check size={13} /> : index + 1}</span>
            <div><strong>{item.label}</strong><small>{item.description}</small></div>
          </button>
        ))}
        <div className="createNotice">
          <CheckCircle size={14} />
          <span>Creation deploys an empty OTF. Only token addresses and raw bootstrap units enter the portfolio payload.</span>
        </div>
      </aside>

      <section className="sectionCard createForm">
        <div className="sectionTitle">
          <div className="sectionHeading">
            <div className="sectionTitleLine"><span className="stepNumber">{step + 1}</span><h2>{steps[step].label}</h2></div>
            <p>{steps[step].description}</p>
          </div>
          <span className="stateBadge muted">Step {step + 1} of {steps.length}</span>
        </div>
        <div className="sectionBody">
          {step === 0 ? (
            <div className="formSection">
              <div className="formGrid twoColumns">
                <label><span>OTF name</span><input value={name} onChange={(event) => { setName(event.target.value); resetSubmission(); }} onBlur={() => setName((value) => value.trimEnd())} placeholder="Technology Leaders OTF" aria-invalid={!nameValid} aria-describedby="create-name-help" /><small id="create-name-help">Immutable onchain identity; must end in “ OTF”.</small></label>
                <label><span>OTF ticker</span><input value={symbol} onChange={(event) => { setSymbol(event.target.value.toUpperCase().replace(/[^A-Z0-9-]/gu, "").slice(0, 16)); resetSubmission(); }} placeholder="TECH" aria-invalid={!symbolValid} aria-describedby="create-symbol-help" /><small id="create-symbol-help">Uppercase letters, numbers and hyphens.</small></label>
              </div>
              <label>
                <div className="subHeader"><span>Strategy rationale</span><small>{mandateBytes.toLocaleString()} / {MAX_MANDATE_BYTES.toLocaleString()} bytes</small></div>
                <textarea value={mandate} onChange={(event) => { setMandate(event.target.value); resetSubmission(); }} rows={4} maxLength={MAX_MANDATE_BYTES} placeholder="Describe what this basket is designed to represent." aria-invalid={mandateBytes === 0 || mandateBytes > MAX_MANDATE_BYTES} aria-describedby="create-mandate-help" />
                <small id="create-mandate-help">Application metadata only. It is not sent to the factory.</small>
              </label>
              {!identityValid ? <div className="validationSummary" role="status"><CircleAlert size={15} /><div><strong>Complete the identity</strong><span>Use a valid name and ticker, and add a rationale within the byte limit.</span></div></div> : null}
            </div>
          ) : null}

          {step === 1 ? (
            <div className="formSection">
              <div className="formIntro constituentsIntro">
                <div>
                  <strong>Initial portfolio</strong>
                  <span>Choose up to 20 assets and set the weight of each constituent.</span>
                </div>
                <div className="constituentsActions">
                  <span className="stateBadge muted">{selectedAssets.length} / 20 assets</span>
                  <span id="basket-percentage-total" className={`stateBadge ${percentagesValid ? "success" : "danger"}`} role="status" aria-live="polite">{percentagesValid ? "100.0000%" : `${formatPercentageExact(totalPercentage)}% total`}</span>
                  <button className="secondaryAction compactAction" type="button" disabled={!selectedAssets.length} onClick={resetMarketCapWeights}><RotateCcw size={13} />Reset to market-cap weights</button>
                </div>
              </div>

              <div className="createAssetList">
                {selectedAssets.map((asset, index) => {
                  const result = previewRows?.[index];
                  const assetError = assetErrors[index];
                  const percentageHelpId = `basket-percentage-help-${asset.address.slice(2)}`;
                  return (
                    <div className="createAssetRow constituentWeightRow" key={asset.address}>
                      <label className="assetSelectField">
                        <span>Asset</span>
                        <select value={asset.address} onChange={(event) => replaceAsset(asset.address, event.target.value)} aria-label={`Constituent ${index + 1} asset`}>
                          <option value={asset.address}>{asset.symbol} — {asset.name}</option>
                          {remainingAssets.map((candidate) => <option key={candidate.address} value={candidate.address}>{candidate.symbol} — {candidate.name}</option>)}
                        </select>
                        <small>{shortAddress(asset.address)}{asset.verified ? " · Verified asset" : ""}</small>
                      </label>
                      <label className="constituentWeightField">
                        <span>Weight</span>
                        <div className="inputWithSuffix"><input inputMode="decimal" value={focusedPercentage === asset.address ? asset.percentageInput : formatPercentageInput(asset.percentageUnits)} onFocus={(event) => { flushSync(() => setFocusedPercentage(asset.address)); event.currentTarget.select(); }} onBlur={() => setFocusedPercentage(undefined)} onChange={(event) => editPercentage(asset.address, event.target.value)} aria-label={`${asset.symbol} percentage`} aria-invalid={!percentagesValid || Boolean(assetError)} aria-describedby={`basket-percentage-total ${percentageHelpId}`} title={`Exact internal weight: ${formatPercentageExact(asset.percentageUnits)}%`} /><span>%</span></div>
                        <small id={percentageHelpId}>{result ? `Minimum ${result.minimumPercentage}` : "Minimum unavailable"}</small>
                      </label>
                      <div className="constituentAssetFacts">
                        <span>Current price <strong>${asset.priceUsd}</strong></span>
                        <span>Market cap <strong>${asset.marketCapUsd}</strong></span>
                        <span>Quantity per OTF <strong>{result && result.rawQuantity > 0n ? `${result.tokenQuantity} ${asset.symbol}` : "—"}</strong></span>
                      </div>
                      <button className="removeCreateAsset" type="button" aria-label={`Remove ${asset.symbol}`} onClick={() => removeAsset(asset.address)}><Trash2 size={14} /></button>
                      {assetError ? <div className="basketAssetError" role="status" aria-live="polite"><CircleAlert size={14} /><span>{assetError}</span></div> : null}
                    </div>
                  );
                })}
              </div>
              <button type="button" className="secondaryAction addCreateAsset" disabled={assetLoadState !== "ready" || !remainingAssets.length || selectedAssets.length >= 20} onClick={() => remainingAssets[0] && addAsset(remainingAssets[0].address)}><Plus size={14} />Add constituent</button>
              {!selectedAssets.length ? <div className="inlineEmptyState"><Plus size={17} /><div><strong>Select at least one priced asset</strong><span>The app needs current price, market cap and token decimals before it can calculate raw bootstrap units.</span></div></div> : null}
              {basketGlobalError && selectedAssets.length ? <div className="validationSummary" role="status"><CircleAlert size={15} /><div><strong>Basket calculation needs attention</strong><span>{basketGlobalError}</span></div></div> : null}
              {marketCapSnapshotAt ? <small className="constituentsSnapshot">Prices and market caps: {formatMarketCapSnapshotTimestamp(marketCapSnapshotAt)}. The $1.00 initial basket target is not a peg or guaranteed market price.</small> : null}
            </div>
          ) : null}

          {step === 2 ? (
            <div className="formSection">
              <div className="formGrid twoColumns">
                <label><span>Annual creator expense ratio</span><div className="inputWithSuffix"><input inputMode="numeric" value={expenseRatio} onChange={(event) => { if (/^\d*$/u.test(event.target.value)) { setExpenseRatio(event.target.value); resetSubmission(); } }} aria-invalid={!Number.isInteger(annualExpenseRatioBps) || annualExpenseRatioBps < 0 || annualExpenseRatioBps > 1_000} aria-describedby="create-expense-help" /><span>bps</span></div><small id="create-expense-help">Immutable; 0–1000 basis points.</small></label>
                <label><span>Fixed beneficiary</span><input value={beneficiary} onChange={(event) => { setBeneficiary(event.target.value.trim()); resetSubmission(); }} placeholder="0x…" aria-invalid={!isAddress(beneficiary) || beneficiary.toLowerCase() === zeroAddress} aria-describedby="create-beneficiary-help" /><small id="create-beneficiary-help">Receives the creator share of accrued fee shares.</small></label>
              </div>
              <aside className="riskCallout warning"><CircleAlert size={15} /><div><strong>Fee shares dilute every existing holder.</strong><span>10% is the protocol maximum and is not recommended. The protocol split is fixed by the factory.</span></div></aside>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="formSection reviewSection">
              <div className="reviewHero"><span className="vaultMonogram">NEW</span><div><h2>{reviewSnapshot.name || "Unnamed OTF"}</h2><span>{reviewSnapshot.symbol || "No ticker"} · created empty by {reviewSnapshot.creator ? shortAddress(reviewSnapshot.creator) : "the connected wallet"}</span></div></div>
              <div className="reviewGrid">
                <div className="reviewKeyMetric"><span>Initial basket target</span><strong>$1.00 per OTF</strong></div>
                <div><span>Rounded basket value</span><strong>{reviewSnapshot.calculation ? `$${reviewSnapshot.calculation.realizedValueUsd}` : "Invalid basket"}</strong></div>
                <div><span>Creator fee</span><strong>{Number.isFinite(reviewSnapshot.annualExpenseRatioBps) ? `${reviewSnapshot.annualExpenseRatioBps} bps` : "Invalid"}</strong></div>
                <div><span>Weighting method</span><strong>{reviewSnapshot.creationMetadata ? weightingMethodLabel(reviewSnapshot.creationMetadata.weightingMethod) : "Weighting method unavailable"}</strong></div>
              </div>
              <div className="reviewBasketTableWrap">
                <table className="reviewBasketTable">
                  <thead><tr><th>Constituent</th><th>Market-cap %</th><th>Selected %</th><th>Multiplier</th><th>Realized %</th><th>Raw unit committed</th></tr></thead>
                  <tbody>{reviewSnapshot.selectedAssets.map((asset, index) => { const metadataRow = reviewSnapshot.creationMetadata?.constituents[index]; return <tr key={asset.address}><td><strong>{asset.symbol}</strong><small>{shortAddress(asset.address)}</small></td><td>{metadataRow ? formatPercentageDisplay(BigInt(metadataRow.marketCapDefaultPercentageUnits)) : "—"}</td><td title={`${formatPercentageExact(asset.percentageUnits)}%`}>{formatPercentageDisplay(asset.percentageUnits)}</td><td>{metadataRow ? formatMarketCapMultiplier(BigInt(metadataRow.multiplierUnits)) : "—"}</td><td>{reviewSnapshot.calculation?.rows[index]?.realizedPercentage ?? "—"}</td><td className="monoValue">{reviewSnapshot.calculation?.rows[index]?.rawQuantity.toString() ?? "—"}</td></tr>; })}</tbody>
                </table>
              </div>
              <aside className="bootstrapCommitNote"><CheckCircle size={16} /><div><strong>Onchain payload is deliberately small</strong><p>The transaction commits the ordered constituent addresses and raw bootstrap units above, plus identity and fee settings. Prices, market caps, precise percentages, the $1 target and rationale stay in the application.</p></div></aside>
              <p className="createBlocked">No constituent tokens are transferred during creation. With zero supply, the first depositor must mint at least 0.01 OTF, with no maximum, by supplying the bootstrap basket ceiling-scaled against one full OTF.</p>
              {!deploymentReady && !creationLocked ? <div className="validationSummary"><CircleAlert size={15} /><div><strong>Creation deployment unavailable</strong><span>The factory is not configured on this network. Review remains available, but submission is disabled.</span></div></div> : null}
              {submissionMessage ? <div className={`validationSummary ${submission === "success" ? "success" : submission === "failure" ? "danger" : ""}`} role="status" aria-live="polite">{submission === "submitting" ? <LoaderCircle className="createAssetSpinner" size={15} /> : submission === "success" ? <CheckCircle size={15} /> : <CircleAlert size={15} />}<div><strong>{submission === "success" ? "Creation confirmed" : submission === "failure" ? "Creation failed" : submission === "unknown" ? "Confirmation unavailable" : "Creation pending"}</strong><span>{submissionMessage}</span>{transactionHash ? <a href={`${robinhoodChainTestnet.blockExplorers.default.url}/tx/${transactionHash}`} target="_blank" rel="noreferrer">View transaction</a> : null}{createdVaultAddress ? <a href={`/funds/${createdVaultAddress}`}>View fund details</a> : null}</div></div> : null}
            </div>
          ) : null}

          <div className="createFormActions">
            <button className="secondaryAction" type="button" disabled={creationLocked} onClick={() => step === 0 ? window.location.assign(returnHref) : setStep((current) => current - 1)}><ArrowLeft size={14} />Back</button>
            {step < steps.length - 1 ? <button className="primaryAction" type="button" disabled={!stepValid[step]} onClick={continueToNextStep}>Continue<ArrowRight size={14} /></button> : <button className="primaryAction" type="button" disabled={submitDisabled} onClick={() => void submitCreation()}>{submission === "submitting" ? <LoaderCircle className="createAssetSpinner" size={14} /> : submission === "success" ? <CheckCircle size={14} /> : submission === "unknown" ? <CircleAlert size={14} /> : <FilePlus2 size={14} />}{submission === "submitting" ? "Creating OTF…" : submission === "success" ? "OTF created" : submission === "unknown" ? "Confirmation unknown" : !deploymentReady ? "Creation unavailable" : !address ? "Connect wallet to create" : "Create empty OTF"}</button>}
          </div>
        </div>
      </section>
    </div>
  );
}
