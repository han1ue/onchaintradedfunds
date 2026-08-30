# Onchain Traded Funds

Onchain Traded Funds (OTFs) are experimental ERC-20 basket vaults. A creator commits an ordered constituent list and immutable raw-token bootstrap units for one OTF. The application derives those units from a fixed `$1` target initial basket value based on current offchain prices—not a peg—and labels exact market-cap defaults or creator-modified tilts as informational creation methodology. Contracts never receive prices, market caps, the target, percentage weights, multipliers, or methodology and do not calculate runtime NAV or rebalance.

This repository contains the Solidity protocol, the operating application, and a separate prelaunch competition. The protocol is pre-mainnet, unaudited, and not production-ready.
