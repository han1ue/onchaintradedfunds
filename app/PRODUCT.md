# Onchain Traded Funds application

The main application creates, trades, and inspects oracleless basket OTFs. It is an operating interface for the protocol, not an independent source of protocol state.

## Routes

- `/` contains the shared Swap interface.
- `/token` embeds the same Swap implementation with protocol OTF selected by default.
- `/funds` lists vaults from the configured factory.
- `/funds/<address>` reads a vault by address.
- `/launch` creates a vault. This route is unrelated to the separate competition under `launch/`.
- `/liquidity` is a testnet-only Synthra V3 liquidity utility.

## Vault creation

The connected wallet becomes the creator. The form collects a name, symbol, fund thesis, one to 20 ordered constituents, three fee rates, and a fixed expense beneficiary. The factory stores the creator, thesis, constituent order, raw bootstrap units, rates, and beneficiary in a new empty vault clone.

The fund thesis must contain no more than 2,048 UTF-8 bytes. Annual expense, mint, and redeem rates are limited to 10%, 2%, and 1%. All three rates and the beneficiary are permanent.

### Basket calculation

The form obtains current USD prices, market caps, and token decimals from the application asset source. It uses a fixed `$1` target initial basket value. That target is neither a peg nor a promised market price.

Market-cap weighting is an explicit mode. While selected, any constituent addition, replacement, or removal recalculates the complete percentage set from current market caps. Editing a percentage switches to manual mode. A new manual constituent begins at 0%, and removing one leaves the remaining manual values unchanged. The creator can restore market-cap mode explicitly.

Percentages use 18-decimal fixed-point units. Each percentage must be positive and the internal sum must equal exactly 100%. The application computes raw bootstrap units with bigint arithmetic, rounds them down, and rejects any allocation that produces zero raw units. It shows the current price, market cap, minimum viable percentage, raw quantity, formatted token quantity, and realized percentage after rounding.

The label `Market-cap weighted` requires every final percentage unit to match its calculated default. Any difference produces `Modified market-cap weighted`. Per-asset multipliers compare the final and default percentage units; token rounding and current vault balances do not affect the label.

The transaction contains the thesis, constituents, and raw units. Prices, market caps, percentages, target value, and weighting method remain offchain metadata. After a confirmed `VaultCreated` event, the browser stores the weighting snapshot by chain and vault. If that record is missing or invalid, the fund page displays `Weighting method unavailable`.

### Submission state

The confirmation view uses the payload captured before submission. Editing, navigation, and resubmission remain locked after broadcast while the transaction is pending, confirmed, or has an indeterminate receipt. A pre-broadcast failure or explicit onchain revert unlocks retry.

After verifying the factory event, the application opens a dedicated confirmation route with the transaction and new vault address. It does not redirect to the fund page until the user chooses to continue.

## Fund data

The Funds directory reads `vaultCount`, each vault address, identity, creator, constituent count, supply, and fee data from the configured factory and vault contracts. A confirmed factory creation therefore appears without a separate indexing service.

The fund page reads the permanent thesis and accounted constituent balances onchain. Informational NAV per share and AUM use current offchain prices. Their history is browser-local and cannot affect contract settlement or execution prices.

For an empty vault, the first mint must produce at least `0.01` shares. The application accepts a quote only when its guaranteed minimum output meets that threshold. There is no first-mint maximum, and the extra check disappears after supply becomes nonzero.

Holders can redeem constituents directly through the contract without swap liquidity. The advanced skip mask is intentionally absent from the interface because selecting a bit permanently forfeits that constituent entitlement.

## Swap

At least one side of a Swap pair must be a vault share or protocol OTF. The application does not expose arbitrary ERC-20 pairs.

Protocol-token pairs request a direct route. Fund-share pairs may request direct pool, basket mint, basket burn, or burn-and-mint candidates. The interface selects the fresh candidate with the highest integer expected output among those queried and retains manual override. It describes this as the best queried route, not the best possible market route.

ETH and WETH are separate selector assets and have separate balances. ETH input never requests ERC-20 or Permit2 approval, and Max native input reserves estimated gas. Testnet fund and protocol-token routes support native ETH through the configured Universal Router. The standalone ETH/WETH pair remains an explicit 1:1 exception that calls canonical WETH directly without a quote service or swap router.

### Quote sources and execution

Production direct routes use the same-origin server integration with Uniswap Trading API exact-input `BEST_PRICE` V3/V4 `CLASSIC` routing. `UNISWAP_API_KEY` remains server-only. Robinhood testnet fund routes use the configured Synthra V3 factory, Quoter, SwapRouter02, and active pools. Canonical WETH/OTF routes use the launch V4 pool.

Testnet basket execution sends typed `mintFromToken`, `mintFromNative`, `redeemToToken`, `redeemToNative`, or `swapBasketToBasket` requests with ordered adapter legs. Before wallet submission, the application simulates the exact sender, target, calldata, value, and route with `eth_call` and `estimateGas`.

`robinhood-testnet-assets.json` distinguishes USDG and WETH quote assets from the five supported constituents and records active Synthra pools. Those constituent pools support basket settlement and the testnet liquidity utility; they are not general Swap pairs. `assets.json` provides production discovery defaults and is not an onchain allowlist.

Verification labels cover identity and ordinary metadata only. They do not establish liquidity, route quality, price, economic safety, audit status, or investment outcome.

## Fee settlement

Annual expense, mint, and redeem fees accrue as vault shares held by `BuybackCollector`. The collector retains the creator and buyback portions recorded when each fee was charged.

Only the immutable beneficiary sees the fee-claim interface. It compares a sale of the exact pending vault shares with a redemption and sale of every constituent, defaults to the higher quoted WETH amount, and permits manual override. The selected atomic settlement pays the recorded creator portion in WETH, spends the buyback portion on OTF, and burns the OTF received.

## Current limits

The current 20-to-180 ETH launch architecture is not deployed on Robinhood Chain Testnet. Protocol reads and writes therefore fail closed. The deployment script must record fresh contract addresses, launch constants, and adapter approvals before the application enables them.

Native basket execution remains disabled until the configuration identifies a compatible entry router. Robinhood Mainnet direct quotes remain unavailable without the server API key. The application does not infer or fabricate missing addresses.
