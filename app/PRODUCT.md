# Onchain Traded Funds application

The application is an operating surface for creating, trading, and inspecting oracleless basket OTFs.

## Product truth

- The Swap route is `/`; Funds is `/funds`; fund detail remains address-routed under `/funds/<address>`; and `/liquidity` is a legacy testnet-only LP utility.
- Creation uses the connected wallet as creator and deploys an empty clone. The creator supplies metadata, an ordered list of at most 20 constituents, immutable raw-token bootstrap units for exactly `1e18` shares, a fixed beneficiary, and an immutable annual creator expense ratio from 0 to 1000 bps.
- The Create route loads current prices, market caps, and token decimals from the existing application asset source. It defaults percentages to market-cap weights normalized deterministically at 18-decimal precision to exactly 100%, permits every positive percentage to be edited with the same precision, and requires the final internal total to equal exactly 100%.
- Every OTF uses a fixed `$1.00` target initial basket value based on current offchain prices. This is an initial calculation target, not a peg or guaranteed market price.
- The app calculates bootstrap units with bigint fixed-point arithmetic from the fixed `1e18` USD-WAD target, current price, token decimals, and final precise percentages. It rounds raw units down, rejects zero raw quantities, shows the minimum viable percentage for each asset, and displays token quantities, raw quantities, and realized percentages after rounding.
- Adding or removing a constituent preserves every existing percentage. Only the explicit “Reset to market-cap weights” action renormalizes the full selection.
- The weighting method is `Market-cap weighted` only when every final percentage unit exactly equals its precise market-cap default; any exact-unit difference is `Modified market-cap weighted`. Per-asset market-cap multipliers compare final and default percentages with bigint fixed-point arithmetic and never use raw-token rounding or current balances.
- After a confirmed creation event, the app stores versioned informational creation metadata in the creator browser, keyed by chain and vault: weighting method, precise market-cap defaults, final percentages, implied multipliers, and the market-cap snapshot timestamp. Fund detail shows that record when available and otherwise says `Weighting method unavailable` without inferring from current balances.
- Once creation submission begins, the confirmation renders from the captured submitted payload. Navigation, editing, and resubmission stay locked through confirmation, success, and an indeterminate receipt lookup; only a pre-broadcast failure or explicit onchain revert unlocks retry.
- Only constituents and calculated bootstrap units are trusted onchain basket inputs. Prices, market caps, the fixed `$1` target, and editable percentages remain application metadata.
- The first depositor can mint one or multiple OTF units by providing the proportionally scaled bootstrap basket. Later deposits use current accounted basket balances per share.
- The protocol fee share is fixed by the factory. A 10% creator expense ratio can materially dilute holders and is not recommended.
- There is no ongoing price oracle, Net Asset Value calculation, rebalance, strategy, proposal, challenge, target-weight system, adapter approval process, or active pool-approval process.
- Verification concerns identity and ordinary metadata only; it never gates routing and never establishes route, liquidity, price, economic safety, audit status, or investment outcome.
- Swap compares only the direct and basket routes that are actually queried. It never claims best price across all venues and never fabricates quotes or transaction states.
- Production liquidity remains external through Uniswap. The internal `/liquidity` utility is limited to wallet-owned, full-range positions in explicitly configured legacy Synthra V3 test pools, always paired with USDG.

## Current limits

The app must keep writes disabled until a schema-11 bootstrap-basket deployment, typed quote/calldata service, and factory directory/history services are configured. Unavailable states should name that limitation plainly.
