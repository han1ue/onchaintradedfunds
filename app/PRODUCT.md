# Onchain Traded Funds application

The application lets users create, trade, and inspect oracleless basket OTFs. It reads protocol state from the configured contracts.

## Routes

- `/` contains the shared Swap interface.
- `/token` embeds the same Swap implementation with protocol OTF selected by default.
- `/funds` lists vaults from the configured factory.
- `/funds/<address>` reads a vault by address.
- `/launch` creates a vault.
- `/liquidity` is a testnet-only Uniswap V3 liquidity utility.

## Vault creation

The connected wallet becomes the creator. The form collects a name, symbol, fund thesis, two to 20 ordered constituents, three fee rates, and a fixed expense beneficiary. It starts with protocol $OTF and one randomly selected verified asset. The factory creates an empty vault with these settings and the calculated raw bootstrap units.

The fund thesis must contain no more than 2,048 UTF-8 bytes. Annual expense, mint, and redeem rates are limited to 10%, 2%, and 1%. All three rates and the beneficiary are permanent.

### Basket calculation

The form uses current USD prices, market caps, and token decimals to calculate a `$1` initial basket. This is a calculation target, not a peg or price guarantee.

In market-cap mode, adding, replacing, or removing a constituent recalculates all percentages. Editing a percentage switches to manual mode: new constituents start at 0%, and removing one leaves the remaining percentages unchanged. The creator can restore market-cap mode.

Percentages use 18-decimal fixed-point units, must be positive, and must sum to exactly 100%. The application calculates raw bootstrap units with bigint arithmetic, rounds down, and rejects zero-unit allocations. The preview shows prices, market caps, minimum viable percentages, raw and formatted token quantities, and percentages after rounding.

`Market-cap weighted` means every final percentage unit matches its calculated default; any difference gives `Modified market-cap weighted`. Per-asset multipliers compare final and default percentages. Token rounding and vault balances do not affect the label.

The thesis, constituents, and raw units go onchain. Prices, market caps, percentages, target value, and weighting method stay offchain. After confirming `VaultCreated`, the browser saves the weighting snapshot by chain and vault. Missing or invalid snapshots display `Weighting method unavailable`.

### Submission state

Confirmation uses the submitted payload. Editing, navigation, and resubmission stay locked after broadcast while the transaction is pending, confirmed, or has an unknown receipt. A failure before broadcast or an onchain revert allows retry.

After verifying the factory event, the application shows the transaction and new vault address on a confirmation route. The user chooses when to open the fund page.

## Fund data

The Funds directory reads vault addresses, identity, creator, constituent count, supply, and fees from the configured factory and vaults. Confirmed vaults appear without a separate indexer.

The fund page reads the permanent thesis and accounted balances onchain. NAV per share and AUM use offchain prices, with history stored in the browser. These informational values do not affect settlement or execution prices.

The Funds summary shows the combined weekly OTF distribution. Each fund estimates depositor rewards APY using emissions from the 65% depositor allocation, current OTF price, and its AUM. Zero-AUM funds use a labeled $100 baseline for the calculation; displayed AUM stays zero. The estimate does not determine Merkle entitlements.

An empty vault's first mint must produce at least `0.01` shares. The quote's guaranteed minimum output must meet this threshold. There is no first-mint maximum; the minimum check ends once supply is nonzero.

Holders can redeem constituents directly through the contract without swap liquidity. The interface omits the advanced skip mask because it permanently forfeits selected constituent entitlements.

## Swap

At least one side of a Swap pair must be a vault share or protocol OTF, except for direct ETH/WETH wrapping.

Protocol-token pairs request a direct route. Fund-share pairs can use a direct pool, basket mint, basket burn, or burn-and-mint route. The interface selects the fresh quote with the highest integer expected output and allows manual override. This is the best queried route; it does not cover every market route.

ETH and WETH have separate selector entries and balances. ETH needs no ERC-20 or Permit2 approval, and Max reserves estimated gas. ETH/WETH wrapping calls canonical WETH directly at 1:1 without a quote service or swap router.

During protocol-token bootstrap, the launch router limits trades to the active range boundary. It consumes only required WETH, refunds unused ETH, and can finalize graduation after the PoolManager call returns. After graduation, trades use the configured Universal Router.

### Quote sources and execution

Production direct routes use the same-origin Uniswap Trading API integration with exact-input `BEST_PRICE` V3/V4 `CLASSIC` routing. `UNISWAP_API_KEY` stays server-only. Robinhood testnet fund routes use the configured Uniswap V3 factory, Quoter, SwapRouter02, and active pools.

Testnet basket execution uses `mintFromToken`, `mintFromNative`, `redeemToToken`, `redeemToNative`, or `swapBasketToBasket` with ordered adapter legs. Before submission, the application simulates the exact sender, target, calldata, value, and route using `eth_call` and `estimateGas`.

`robinhood-testnet-assets.json` lists USDG and WETH quote assets, five constituents, and active V3 pools. Constituent pools support basket settlement and testnet liquidity, rather than general Swap pairs. `assets.json` supplies production discovery defaults, not an onchain allowlist.

Verification labels cover identity and ordinary metadata only. They do not establish liquidity, route quality, price, economic safety, audit status, or investment outcome.

## Fee settlement

Annual expense, mint, and redeem fees accrue as vault shares in `BuybackCollector`, which records the creator and buyback portions when each fee is charged.

Only the fixed beneficiary sees the fee-claim interface. It compares selling the pending shares with redeeming and selling every constituent, selects the higher WETH quote, and allows manual override. Settlement atomically pays the creator portion in WETH, buys OTF with the buyback portion, and burns the OTF received.

## Current limits

The active Robinhood Chain Testnet launch uses a reference FDV of 15 ETH at initialization and approximately 134.997562702653186573 ETH at graduation. The application reads contracts, launch amounts, and approved adapters from the deployment manifest.

Testnet native basket execution uses the canonical-WETH entry router. Robinhood Mainnet direct quotes require the server API key. Missing addresses remain unavailable.
