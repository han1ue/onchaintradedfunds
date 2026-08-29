# Onchain Traded Funds application

The application is an operating surface for creating and inspecting oracleless market-cap-at-formation OTFs.

## Product truth

- The Swap route is `/`; Funds is `/otfs`; fund detail remains address-routed under `/otfs/<address>`.
- Formation relies on an authenticated, expiring snapshot that binds the chain, factory, intended creator, ordered constituent addresses and token decimals, market caps, unit prices, calculation version, and nonce.
- A creator supplies metadata, an ordered list of at most 20 addresses, a fixed beneficiary, and an immutable annual creator expense ratio from 0 to 1000 bps.
- The formation-allocation rebate benefits the creator and does not reduce the holder fee. A 10% creator expense ratio can dilute holders and is not recommended.
- There is no ongoing price oracle, Net Asset Value calculation, rebalance, strategy, proposal, challenge, target-weight system, adapter approval process, or active pool-approval process.
- Verification concerns identity and ordinary metadata only; it never gates routing and never establishes route, liquidity, price, economic safety, audit status, or investment outcome.
- Swap compares only the direct and basket routes that are actually queried. It never claims best price across all venues and never fabricates quotes or transaction states.
- Liquidity remains external: use Uniswap on Robinhood Chain and Synthra on Robinhood Chain Testnet only when trusted configuration and a selected OTF/USDG pair permit a link. A link never implies an official pool.

## Current limits

The app must keep writes disabled until new deployments plus typed quote/calldata, authenticated snapshot/create, and factory directory/history services are configured. Unavailable states should name that limitation plainly.
