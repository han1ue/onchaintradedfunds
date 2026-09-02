"use client";

import { useConnectModal } from "@rainbow-me/rainbowkit";
import { otfFactoryAbi } from "@onchaintradedfunds/generated";
import {
  ArrowRight,
  Check,
  CheckCircle,
  ChevronDown,
  CircleAlert,
  FilePlus2,
  LoaderCircle,
  LockKeyhole,
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
  annualExpenseRatioBpsFromPercentage,
  calculateBootstrapBasketUnits,
  formatAnnualExpenseRatioPercentage,
  formatPercentageDisplay,
  formatPercentageExact,
  formatPercentageInput,
  percentageUnits,
  percentageUnitsForSelectionChange,
  previewBootstrapBasketUnits,
  resetToMarketCapPercentageUnits,
  submitAndConfirmCreation,
  vaultCreationTransactionParams,
  zeroRawUnitError,
  type BasketCalculation,
  type CreationAssetData,
} from "@/lib/creation-model";
import {
  buildCreationMetadataDraft,
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
  mintFeeBps: number;
  redeemFeeBps: number;
  creator: Address;
  selectedAssets: SelectedAsset[];
  calculation: BasketCalculation;
  creationMetadata: OtfCreationMetadataDraft;
};

const MAX_MANDATE_BYTES = 2_048;
const ALLOCATION_COLORS = ["#37b7aa", "#6f8cff", "#f1b93d", "#d879d8", "#eb6570", "#65c982"];

const steps = [
  { label: "Identity", description: "Onchain identity and thesis" },
  { label: "Constituents", description: "Choose assets and weights" },
  { label: "Economics", description: "Fee and beneficiary" },
  { label: "Review", description: "Confirm OTF details" },
] as const;

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function trimTrailingDecimalZeros(value: string): string {
  return value.includes(".") ? value.replace(/0+$/u, "").replace(/\.$/u, "") : value;
}

function formatCompactUsd(value: string): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return value;
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(amount);
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
    percentageInput: formatPercentageInput(percentages[index]),
    percentageUnits: percentages[index],
  }));
}

function selectionForWeightMode(
  current: readonly SelectedAsset[],
  next: readonly CreationAssetData[],
  marketCapWeighted: boolean,
): SelectedAsset[] {
  const percentages = percentageUnitsForSelectionChange(
    current.map((asset) => ({ key: asset.address, percentageUnits: asset.percentageUnits })),
    next.map((asset) => ({ key: asset.address, marketCapUsd: asset.marketCapUsd })),
    marketCapWeighted,
  );
  return next.map((asset, index) => {
    const existing = current.find((candidate) => candidate.address === asset.address);
    return existing && !marketCapWeighted ? existing : {
      ...asset,
      percentageInput: formatPercentageInput(percentages[index]),
      percentageUnits: percentages[index],
    };
  });
}

export function CreateOTFForm() {
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
  const [mintFee, setMintFee] = useState("0");
  const [redeemFee, setRedeemFee] = useState("0");
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
  const [marketCapWeighted, setMarketCapWeighted] = useState(true);
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
      setMarketCapWeighted(true);
      setMarketCapSnapshotAt(new Date(payload.marketCapSnapshotAt).toISOString());
      setAssetLoadState(assets.length ? "ready" : "empty");
    }).catch(() => {
      if (!controller.signal.aborted) setAssetLoadState("failure");
    });
    return () => controller.abort();
  }, [chainId]);

  const normalizedFundThesis = mandate.trim();
  const mandateBytes = new TextEncoder().encode(normalizedFundThesis).length;
  const normalizedName = name.trim();
  const nameValid = normalizedName.length > 4 && normalizedName.endsWith(" OTF");
  const symbolValid = /^[A-Z0-9][A-Z0-9-]*$/u.test(symbol);
  const identityValid = nameValid && symbolValid && mandateBytes > 0
    && mandateBytes <= MAX_MANDATE_BYTES;
  const totalPercentage = selectedAssets.reduce((sum, asset) => sum + asset.percentageUnits, 0n);
  const allocationPieBackground = useMemo(() => {
    if (totalPercentage <= 0n) return "var(--card-raised)";
    let completed = 0n;
    const segments = selectedAssets.map((asset, index) => {
      const start = Number(completed * 10_000n / totalPercentage) / 100;
      completed += asset.percentageUnits;
      const end = index === selectedAssets.length - 1
        ? 100
        : Number(completed * 10_000n / totalPercentage) / 100;
      return `${ALLOCATION_COLORS[index % ALLOCATION_COLORS.length]} ${start}% ${end}%`;
    });
    return `conic-gradient(${segments.join(", ")})`;
  }, [selectedAssets, totalPercentage]);
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
  const annualExpenseRatioBps = annualExpenseRatioBpsFromPercentage(expenseRatio);
  const mintFeeBps = annualExpenseRatioBpsFromPercentage(mintFee);
  const redeemFeeBps = annualExpenseRatioBpsFromPercentage(redeemFee);
  const economicsValid = Number.isInteger(annualExpenseRatioBps)
    && annualExpenseRatioBps >= 0 && annualExpenseRatioBps <= 1_000
    && Number.isInteger(mintFeeBps) && mintFeeBps >= 0 && mintFeeBps <= 200
    && Number.isInteger(redeemFeeBps) && redeemFeeBps >= 0 && redeemFeeBps <= 100
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
    mintFeeBps,
    redeemFeeBps,
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
    setSelectedAssets((current) => selectionForWeightMode(current, [...current, asset], marketCapWeighted));
    resetSubmission();
  }

  function replaceAsset(addressValue: Address, nextAddressValue: string) {
    const replacement = availableAssets.find((candidate) => candidate.address === nextAddressValue);
    if (!replacement) return;
    setSelectedAssets((current) => {
      const next = current.map((asset) => (
        asset.address === addressValue
          ? { ...replacement, percentageInput: asset.percentageInput, percentageUnits: asset.percentageUnits }
          : asset
      ));
      return marketCapWeighted ? applyMarketCapDefaults(next) : next;
    });
    resetSubmission();
  }

  function removeAsset(addressValue: Address) {
    setSelectedAssets((current) => selectionForWeightMode(
      current,
      current.filter((asset) => asset.address !== addressValue),
      marketCapWeighted,
    ));
    resetSubmission();
  }

  function resetMarketCapWeights() {
    setSelectedAssets((current) => applyMarketCapDefaults(current));
    setMarketCapWeighted(true);
    resetSubmission();
  }

  function editPercentage(addressValue: Address, value: string) {
    const next = fixedInput(value, PERCENT_DECIMALS);
    if (next === undefined) return;
    const units = percentageUnits(next) ?? 0n;
    setMarketCapWeighted(false);
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
      mintFeeBps,
      redeemFeeBps,
      creator: address,
      selectedAssets: selectedAssets.map((asset) => ({ ...asset })),
      calculation,
      creationMetadata,
    });
    setSubmission("submitting");
    setSubmissionMessage("Confirm the OTF creation transaction in your wallet.");
    setTransactionHash(undefined);
    let confirmedVaultAddress: Address | undefined;
    const outcome = await submitAndConfirmCreation({
      write: async () => {
        const hash = await walletClient.writeContract({
          address: factory,
          abi: otfFactoryAbi,
          functionName: "createVault",
          args: [vaultCreationTransactionParams({
            name: normalizedName,
            symbol,
            fundThesis: normalizedFundThesis,
            expenseBeneficiary: getAddress(beneficiary),
            annualCreatorExpenseRatioBps: annualExpenseRatioBps,
            mintFeeBps,
            redeemFeeBps,
            constituents: selectedAssets.map((asset) => asset.address),
            bootstrapBasketUnitsPerOTF: calculation.bootstrapBasketUnitsPerOTF,
          })],
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
        setSubmissionMessage("OTF created, but its informational methodology could not be associated because the creation event was unavailable.");
        return;
      }
      setCreatedVaultAddress(confirmedVaultAddress);
      try {
        persistCreationMetadata(window.localStorage, chainId, confirmedVaultAddress, creationMetadata);
        setSubmissionMessage("OTF created. Opening its confirmation page.");
      } catch {
        setSubmissionMessage("OTF created. Its informational methodology could not be stored in this browser.");
      }
      window.location.assign(`/funds/${confirmedVaultAddress}/created?tx=${outcome.hash}`);
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
          <span>Creation deploys an empty OTF. Its thesis, token addresses, and raw bootstrap units are committed onchain.</span>
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
                <div className="subHeader"><span>Fund thesis</span><small>{mandateBytes.toLocaleString()} / {MAX_MANDATE_BYTES.toLocaleString()} bytes</small></div>
                <textarea value={mandate} onChange={(event) => { setMandate(event.target.value); resetSubmission(); }} rows={4} maxLength={MAX_MANDATE_BYTES} placeholder="Describe what this basket is designed to represent." aria-invalid={mandateBytes === 0 || mandateBytes > MAX_MANDATE_BYTES} aria-describedby="create-mandate-help" />
                <small id="create-mandate-help">Stored permanently onchain when the fund is created and cannot be changed.</small>
              </label>
              {!identityValid ? <div className="validationSummary" role="status"><CircleAlert size={15} /><div><strong>Complete the identity</strong><span>Use a valid name and ticker, and add a thesis within the byte limit.</span></div></div> : null}
            </div>
          ) : null}

          {step === 1 ? (
            <div className="formSection">
              <div className="formIntro constituentsIntro">
                <div>
                  <strong>Build the basket</strong>
                  <span>{marketCapWeighted ? "Weights automatically follow current market caps." : "Manual weights stay unchanged when assets are added or removed."}</span>
                </div>
                <div className="constituentsActions">
                  <button className={`secondaryAction compactAction weightingModeButton${marketCapWeighted ? " selected" : ""}`} type="button" aria-pressed={marketCapWeighted} disabled={!selectedAssets.length} onClick={resetMarketCapWeights}>{marketCapWeighted ? <Check size={13} /> : <RotateCcw size={13} />}Market-cap weighted</button>
                </div>
              </div>
              <span id="basket-percentage-total" className="visuallyHidden" role="status" aria-live="polite">Allocation total: {formatPercentageDisplay(totalPercentage)}</span>

              <div className="allocationComposer">
                <div className="allocationChartPanel combinedAllocationOverview">
                  <div className="allocationPie" style={{ background: allocationPieBackground }} role="img" aria-label={`Portfolio allocation chart. ${selectedAssets.map((asset) => `${asset.symbol} ${formatPercentageDisplay(asset.percentageUnits)}`).join(", ")}`}>
                    <span>{percentagesValid ? "100%" : formatPercentageDisplay(totalPercentage)}</span>
                  </div>
                  <div className="allocationLegend">
                    {selectedAssets.map((asset, index) => <div key={asset.address}><span style={{ background: ALLOCATION_COLORS[index % ALLOCATION_COLORS.length] }} /><strong>{asset.symbol}</strong><small>{formatPercentageDisplay(asset.percentageUnits)}</small></div>)}
                  </div>
                  <button type="button" className="secondaryAction addCreateAsset" disabled={assetLoadState !== "ready" || !remainingAssets.length || selectedAssets.length >= 20} onClick={() => remainingAssets[0] && addAsset(remainingAssets[0].address)}><Plus size={14} />Add constituent</button>
                </div>

                <div className="createAssetList combinedConstituentList">
                  {selectedAssets.map((asset, index) => {
                  const result = previewRows?.[index];
                  const assetError = assetErrors[index];
                  const percentageHelpId = `basket-percentage-help-${asset.address.slice(2)}`;
                  return (
                    <div className="constituentWeightRow" key={asset.address}>
                      <label className="assetSelectField">
                        <span>Asset</span>
                        <div className="selectControl">
                          <select value={asset.address} onChange={(event) => replaceAsset(asset.address, event.target.value)} aria-label={`Constituent ${index + 1} asset`}>
                            <option value={asset.address}>{asset.symbol} — {asset.name}</option>
                            {remainingAssets.map((candidate) => <option key={candidate.address} value={candidate.address}>{candidate.symbol} — {candidate.name}</option>)}
                          </select>
                          <ChevronDown size={14} aria-hidden="true" />
                        </div>
                        <small>{shortAddress(asset.address)}{asset.verified ? " · Verified asset" : ""}</small>
                      </label>
                      <label className="constituentWeightField">
                        <span>Weight</span>
                        <div className="inputWithSuffix"><input inputMode="decimal" value={focusedPercentage === asset.address ? asset.percentageInput : formatPercentageInput(asset.percentageUnits)} onFocus={(event) => { flushSync(() => setFocusedPercentage(asset.address)); event.currentTarget.select(); }} onBlur={() => { setFocusedPercentage(undefined); setSelectedAssets((current) => current.map((currentAsset) => currentAsset.address === asset.address ? { ...currentAsset, percentageInput: formatPercentageInput(currentAsset.percentageUnits) } : currentAsset)); }} onChange={(event) => editPercentage(asset.address, event.target.value)} aria-label={`${asset.symbol} percentage`} aria-invalid={!percentagesValid || Boolean(assetError)} aria-describedby={`basket-percentage-total ${percentageHelpId}`} title={`Exact internal weight: ${formatPercentageExact(asset.percentageUnits)}%`} /><span>%</span></div>
                        <small id={percentageHelpId}>{result ? `Minimum ${result.minimumPercentage}` : "Minimum unavailable"}</small>
                      </label>
                      <div className="constituentAssetFacts">
                        <span>Current price <strong>${trimTrailingDecimalZeros(asset.priceUsd)}</strong></span>
                        <span>Market cap <strong>${formatCompactUsd(asset.marketCapUsd)}</strong></span>
                        <span>Quantity per OTF <strong>{result && result.rawQuantity > 0n ? `${result.tokenQuantity} ${asset.symbol}` : "—"}</strong></span>
                      </div>
                      <button className="removeCreateAsset" type="button" aria-label={`Remove ${asset.symbol}`} onClick={() => removeAsset(asset.address)}><Trash2 size={14} /></button>
                      {assetError ? <div className="basketAssetError" role="status" aria-live="polite"><CircleAlert size={14} /><span>{assetError}</span></div> : null}
                    </div>
                  );
                  })}
                </div>
              </div>
              {!selectedAssets.length ? <div className="inlineEmptyState">{assetLoadState === "loading" ? <LoaderCircle className="createAssetSpinner" size={18} aria-label="Please wait" /> : <Plus size={17} />}<div>{assetLoadState === "loading" ? null : <><strong>Select at least one priced asset</strong><span>The app needs current price, market cap and token decimals before it can calculate raw bootstrap units.</span></>}</div></div> : null}
              {basketGlobalError && selectedAssets.length ? <div className="validationSummary" role="status"><CircleAlert size={15} /><div><strong>Basket calculation needs attention</strong><span>{basketGlobalError}</span></div></div> : null}
              {marketCapSnapshotAt ? <small className="constituentsSnapshot">Prices and market caps: {formatMarketCapSnapshotTimestamp(marketCapSnapshotAt)}.</small> : null}
            </div>
          ) : null}

          {step === 2 ? (
            <div className="formSection">
              <div className="formGrid twoColumns">
                <label><span>Annual creator expense ratio</span><div className="inputWithSuffix"><input inputMode="decimal" value={expenseRatio} onChange={(event) => { const next = fixedInput(event.target.value, 2); if (next !== undefined) { setExpenseRatio(next); resetSubmission(); } }} aria-invalid={!Number.isInteger(annualExpenseRatioBps) || annualExpenseRatioBps < 0 || annualExpenseRatioBps > 1_000} aria-describedby="create-expense-help" /><span>%</span></div><small id="create-expense-help">Immutable; 0–10%.</small></label>
                <label><span>Mint fee</span><div className="inputWithSuffix"><input inputMode="decimal" value={mintFee} onChange={(event) => { const next = fixedInput(event.target.value, 2); if (next !== undefined) { setMintFee(next); resetSubmission(); } }} aria-invalid={!Number.isInteger(mintFeeBps) || mintFeeBps < 0 || mintFeeBps > 200} aria-describedby="create-mint-fee-help" /><span>%</span></div><small id="create-mint-fee-help">Immutable; defaults to 0%, maximum 2%.</small></label>
                <label><span>Redeem fee</span><div className="inputWithSuffix"><input inputMode="decimal" value={redeemFee} onChange={(event) => { const next = fixedInput(event.target.value, 2); if (next !== undefined) { setRedeemFee(next); resetSubmission(); } }} aria-invalid={!Number.isInteger(redeemFeeBps) || redeemFeeBps < 0 || redeemFeeBps > 100} aria-describedby="create-redeem-fee-help" /><span>%</span></div><small id="create-redeem-fee-help">Immutable; defaults to 0%, maximum 1%. Shutdown exits are free.</small></label>
                <label><span>Fixed beneficiary</span><input value={beneficiary} onChange={(event) => { setBeneficiary(event.target.value.trim()); resetSubmission(); }} placeholder="0x…" aria-invalid={!isAddress(beneficiary) || beneficiary.toLowerCase() === zeroAddress} aria-describedby="create-beneficiary-help" /><small id="create-beneficiary-help">Receives the creator share of accrued fee shares.</small></label>
              </div>
              <aside className="feePermanenceNote"><LockKeyhole size={15} /><div><strong>All three fee rates are permanent.</strong><span>Accounted OTF changes only the creator versus buyback-and-burn split; it never changes the investor&apos;s configured fee rate.</span></div></aside>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="formSection reviewSection">
              <div className="reviewHero"><span className="vaultMonogram" title={reviewSnapshot.name || "Unnamed OTF"}>{reviewSnapshot.name || "OTF"}</span><div><h2>{reviewSnapshot.name || "Unnamed OTF"}</h2><span>{reviewSnapshot.symbol || "No ticker"} · created empty by {reviewSnapshot.creator ? shortAddress(reviewSnapshot.creator) : "the connected wallet"}</span></div></div>
              <div className="reviewGrid">
                <div><span>Creator fee</span><strong>{formatAnnualExpenseRatioPercentage(reviewSnapshot.annualExpenseRatioBps)}</strong></div>
                <div><span>Mint fee</span><strong>{formatAnnualExpenseRatioPercentage(reviewSnapshot.mintFeeBps)}</strong></div>
                <div><span>Redeem fee</span><strong>{formatAnnualExpenseRatioPercentage(reviewSnapshot.redeemFeeBps)}</strong></div>
                <div><span>Weighting method</span><strong>{reviewSnapshot.creationMetadata ? weightingMethodLabel(reviewSnapshot.creationMetadata.weightingMethod) : "Weighting method unavailable"}</strong></div>
              </div>
              <div className="reviewBasketTableWrap">
                <table className="reviewBasketTable">
                  <thead><tr><th>Constituent</th><th>Percentage</th></tr></thead>
                  <tbody>{reviewSnapshot.selectedAssets.map((asset) => <tr key={asset.address}><td><strong>{asset.symbol}</strong><small>{asset.name} · {shortAddress(asset.address)}</small></td><td title={`${formatPercentageExact(asset.percentageUnits)}%`}>{formatPercentageDisplay(asset.percentageUnits)}</td></tr>)}</tbody>
                </table>
              </div>
              <aside className="bootstrapCommitNote"><CheckCircle size={16} /><div><strong>Ready to create</strong><p>The transaction creates the OTF with these constituents, initial percentages, identity, fund thesis, and fee settings.</p></div></aside>
              <p className="createBlocked">No constituent tokens are transferred during creation. With zero supply, the first depositor must mint at least 0.01 OTF, with no maximum, by supplying the bootstrap basket ceiling-scaled against one full OTF.</p>
              {!deploymentReady && !creationLocked ? <div className="validationSummary"><CircleAlert size={15} /><div><strong>Creation unavailable</strong><span>The configured testnet factory could not be loaded. Review remains available, but submission is disabled.</span></div></div> : null}
              {submissionMessage ? <div className={`validationSummary ${submission === "success" ? "success" : submission === "failure" ? "danger" : ""}`} role="status" aria-live="polite">{submission === "submitting" ? <LoaderCircle className="createAssetSpinner" size={15} /> : submission === "success" ? <CheckCircle size={15} /> : <CircleAlert size={15} />}<div><strong>{submission === "success" ? "Creation confirmed" : submission === "failure" ? "Creation failed" : submission === "unknown" ? "Confirmation unavailable" : "Creation pending"}</strong><span>{submissionMessage}</span>{transactionHash ? <a href={`${robinhoodChainTestnet.blockExplorers.default.url}/tx/${transactionHash}`} target="_blank" rel="noreferrer">View transaction</a> : null}{createdVaultAddress ? <a href={`/funds/${createdVaultAddress}`}>View fund details</a> : null}</div></div> : null}
            </div>
          ) : null}

          <div className="createFormActions">
            {step < steps.length - 1 ? <button className="primaryAction" type="button" disabled={!stepValid[step]} onClick={continueToNextStep}>Continue<ArrowRight size={14} /></button> : <button className="primaryAction" type="button" disabled={submitDisabled} onClick={() => void submitCreation()}>{submission === "submitting" ? <LoaderCircle className="createAssetSpinner" size={14} /> : submission === "success" ? <CheckCircle size={14} /> : submission === "unknown" ? <CircleAlert size={14} /> : <FilePlus2 size={14} />}{submission === "submitting" ? "Creating OTF…" : submission === "success" ? "OTF created" : submission === "unknown" ? "Confirmation unknown" : !deploymentReady ? "Creation unavailable" : !address ? "Connect wallet to create" : "Create OTF"}</button>}
          </div>
        </div>
      </section>
    </div>
  );
}
