# Launch competition surface brief

## Purpose

The launch application lets visitors compare proposed OTFs, inspect their theses and allocations, submit proposals, cast votes, and audit final XP. Launch rank and XP are separate systems: votes determine launch order, while XP is calculated only after the final audit and never changes that order.

The approved composition is `.impeccable/mocks/launch-board-a.png`. The first viewport centers the ranked leaderboard. Each row shows a concise thesis excerpt and compact allocation strip. A timeline above the board explains the submission-only period, voting period, and final review. The ballot adds one row per proposal and a focused vote-availability summary.

## Competition rules shown in the interface

- The competition starts with seven submission-only days followed by 30 voting days. Submissions remain open during voting.
- Each eligible account receives three votes when voting opens, then one more every three voting days up to 12. The last additional vote becomes available on voting day 27; day 30 adds none.
- Every voting action requires a fresh public X post. One action may batch several available votes.
- Vote posts hide proposal choices by default. Users may explicitly reveal the selected tickers and counts.
- Cast votes cannot move or be removed. Creators may vote for their own proposals.
- Votes for a deleted proposal remain spent and auditable but do not count toward launch rank or any XP category.
- XP appears only after the final audit. The interface must not show a provisional XP balance or rank.
- Verified OTFs compete for a 3.5 million performance XP pool; other OTFs compete for 1.75 million. Individual awards depend on relative score.

The default leaderboard shows OTF launch rank. A separate `Voters & XP` view ranks voters by their latest canonical total XP. Voters use deterministic generated aliases unless they opt in to showing their X username; the setting is reversible.

The final XP ledger shows calculation and checkpoint times, Performance, Participation, and Creator categories, unique supporter count, total XP, and any `Awaiting price checkpoint` state.

## Layout and content

The visual language extends the main application: dark teal by default, compact system typography, flat bordered surfaces, restrained status colors, and tabular numbers.

Desktop uses a six-column XP table. Below 760 px, each participant becomes a labelled two-column row that retains every XP category, supporter count, total, and pending or verification state.

`Submit OTF` does not appear in primary navigation. Non-empty leaderboard headings place it as a secondary action at the top right, while the profile page uses it as a primary action. An empty leaderboard shows one centered submission action.

Leaderboard rows pair the allocation strip with exact percentages. Proposal pages contain the complete allocation. Do not show individual launch dates.

## Implementation inventory

The application includes sticky navigation, competition metrics, phase timeline, leaderboard, allocation strip, ballot, vote ledger, proposal details, submission wizard, account activity, rules, legal pages, and administrator tools. Components use semantic HTML and CSS with Lucide icons. OTF and asset marks use existing SVG assets or CSS geometry; the product ships no generated raster artwork.
