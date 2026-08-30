# Security and threat model

Status: pre-mainnet, unaudited, experimental. No deployment is approved. This document describes
the current oracleless formation architecture; it is not an audit, warranty, or investment advice.

## Security boundary

`OTFFactory` accepts a formation transaction only from the nonzero creator named in a snapshot
whose EIP-712 signature the configured `formationSnapshotAuthority` validates, either through EOA
recovery or ERC-1271. The signed snapshot binds the chain ID, factory, intended creator, ordered
constituents, their ordered token decimals, market caps, unit prices, snapshot time, expiry,
calculation version 1, and nonce. A copied pending transaction from another address fails before it
can consume the one-use nonce. The factory requires each live token `decimals()` response
to equal its signed value and be at most 36, then derives quantities from that signed value. This
fails closed against mutable or caller-dependent decimal metadata. The factory also validates
positive data, contracts, uniqueness, and quantity derivation before cloning a vault.

The signed creator can separately choose unsigned metadata, a fixed expense beneficiary, and an
immutable `annualCreatorExpenseRatioBps` between 0 and 1000. These creation parameters are not
part of the authority-signed snapshot. The creator cannot choose unsigned market data, portfolio
weights, or initial relative quantities. Formation is therefore trust-minimized against creator
substitution, but not against a wrong or compromised authority/data source.

There is deliberately no runtime NAV, price oracle, Chainlink feed, TWAP, keeper, rebalance engine,
or market-cap refresh in the active contracts. Formation data is not a promise of current value.
Market prices and basket value drift after formation without automatic rebalance.

## Main risks and mitigations

### Formation data and authority

The authority can attest inaccurate, stale, manipulated, or economically unsuitable market caps or
prices. A compromised authority can affect future formations, but cannot rewrite an already-created
vault's snapshot or quantities. It must not be described as an oracle: its signature authenticates
an input, not its truth. The source, data provider, methodology, evidence, key custody, rotation,
expiry policy, monitoring, and incident response are unresolved production requirements.

The repository helper emits validated typed data and a digest only. It rejects raw private-key
signing; production key material must stay in the independently selected authority-custody system.

The one-time router configurator and creator are trust roles. The creator can trigger an
irreversible shutdown while backing is sound; any caller can trigger one when a readable balance
proves a backing deficit. An unreadable token alone does not authorize shutdown. Factory deployment
parameters (authority, collector, protocol token, fee policy, implementation, and authenticated V3
dependencies) must be reviewed and assigned to appropriate control before production.

### Basket accounting and tokens

Vault shares are 18 decimals and the basket has at most 20 immutable constituents. The first mint
requires at least `1e18` shares; subsequent mint requirements use current accounted balances and
ceil pro-rata rounding. Redemption uses floor rounding. Fees checkpoint before supply math.

`accountedBalance` is an internal ledger. A direct tracked-token donation increases the token's
actual balance but not its accounted balance and gives no donor or manager claim. Normal settlement
uses the ledger. A deficit (`actual < accounted`) blocks normal mint/redeem and causes the optional
fee rebate to fail closed. After final shutdown, public in-kind emergency redemption pays no more
than `min(actual, accounted)` per asset, excludes donation excess, and uses safe distributable
backing when a deficit exists.

The contracts require exact sender and receiver balance deltas. Fee-on-transfer, sender-taxed,
rebasing, malicious, callback-mutating, or otherwise non-exact ERC-20s are unsupported; every
unexpected delta must revert. A token that changes balances without a detectable transfer delta can
still be an integration risk and must be excluded by production asset policy. Unsupported tokens
must not be represented as safe merely because a UI marks them verified.

Expected decimals are signed and checked at formation, but the protocol cannot make a proxy token's
implementation or later behavior immutable. Production admission must exclude mutable-decimals,
upgradeable, rebasing, transfer-tax, or callback-capable assets unless their lifecycle and recovery
behavior has been separately reviewed.

### Expense dilution and protocol shares

The creator expense is share inflation, not an asset transfer. The beneficiary is fixed at clone
initialization, and the ratio is immutable. Fee growth is lazy and cadence-independent, retaining
fractional remainders. A 10% annual ratio mints approximately 11.111% of pre-fee supply over 365
days, leaving holders with 90% of the post-fee supply. Shutdown checkpoints once and stops growth.

Protocol fee shares are held by `FeeCollector`, whose treasury is the only claimant. The optional
formation-allocation rebate is based on the signed formation OTF allocation and accounted-token
coverage. It reallocates the protocol portion to the creator; it does not reduce the holder's
creator-selected fee. Coverage is capped at accounted backing, and malformed, deficient, or
unreadable state returns the normal protocol split.

### Router, pools, and external liquidity

`OTFEntryExitRouter` is permissionless execution for caller-supplied typed routes. The immutable
Uniswap V3 factory/router integration authenticates every packed-path pool by factory, ordered
tokens, and fee. Paths are fully parsed (not arbitrary command bytes), with limits of 40 legs and
3 hops per leg. A successful route can track at most 142 token identities under those bounds;
routes that cannot be funded by caller, basket, or earlier-leg flow fail closed. Deadlines,
per-leg and aggregate minimum outputs, exact observed deltas,
temporary approvals cleared after swaps, sender-only recipients/refunds, reentrancy protection,
residual-balance checks, and transaction rollback are enforced.

Offchain discovery/quoting may compare direct and basket routes, but only routes actually queried;
neither app nor contract claims global optimality. There is no adapter allowlist or pool allowlist.
V4 is absent because no PoolManager is configured. The V3 dependency must be the four-field
`exactInput` SwapRouter02 and share its pool init-code family with the configured factory. Reported
`factory()` equality is necessary but insufficient. Funded fork tests must prove direct buy, direct
sell, and multihop execution against the exact production addresses. Pool fees belong to LPs, and
the creator promises neither liquidity nor execution price.

Normal in-kind settlement is router-only. If all usable V3 routes disappear while backing remains
sound, only the creator can activate emergency in-kind redemption. A lost or hostile creator can
therefore strand holders in that venue-outage case; a proven balance deficit remains permissionless
to shut down. This is an explicit liveness limitation, not a pool-selection rule.

The Swap surface's external-liquidity action hands pool creation and LP-position actions to the external venue. It does
not custody LP assets or manage positions. Users must review the leaving-app disclosure, route,
price impact, fees, gas, deadline, and slippage themselves.

The `/liquidity` route is an explicit testnet-only exception for legacy Synthra V3 test pools. It
can approve USDG/test assets and mint wallet-owned full-range positions through the configured
legacy position manager. It is not used for production assets, mainnet liquidity, or protocol-owned
funds.

## Explicit limitations and unresolved blockers

- No formal audit or independent economic review has been completed; passing tests and security
  scripts are not a substitute.
- Production snapshot authority and data provider are unresolved. Authority compromise affects
  future formations only, but bad attestations remain an economic risk.
- New production deployments, governance/key management, monitoring, and incident procedures are
  unresolved.
- The production typed quote service and mainnet OTF addresses are unresolved. Canonical mainnet
  USDG identity is configured separately from testnet deployment state.
- Synthra publishes no documented OTF/USDG pair-prefill URL. Testnet liquidity and data are not
  production evidence.
- Malicious, rebasing, and fee-on-transfer assets remain unsupported despite exact-delta guards;
  asset onboarding and recovery policy must be independently reviewed.
- The configured SwapRouter02/factory bytecode family is trusted and requires funded fork smoke
  tests. The local 40-leg/3-hop mock stress case is only a router-bookkeeping lower bound; the exact
  production paths need `eth_estimateGas` with headroom below the target chain limit. There is no
  V4 integration and no adapter or pool allowlist.
- A sound vault with no usable V3 route still depends on its creator to enable emergency in-kind
  redemption; unreadable-only token failure does not permit a third party to shut it down.
- Formation-only market-cap weighting means value drift, concentration, and stale-source economics
  are user-visible risks. There is no promise that a share tracks a dollar or a current index.
- `launch/` is a separate active prelaunch competition. It is not part of fund governance and is
  intentionally outside this threat model.

Report suspected vulnerabilities privately to the repository maintainers before public disclosure.
Include the affected contract, chain/commit, reproduction steps, impact, and whether funds or keys
may be at risk. Do not include seed phrases or private keys.
