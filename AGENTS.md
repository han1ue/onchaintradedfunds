# Agent Guidelines

These instructions apply to the entire repository.

## Keep Changes Simple

- Do not overengineer. Prefer the smallest clear solution that fully addresses the request.
- Avoid unnecessary abstractions, speculative features, broad refactors, or unrelated cleanup.
- Follow existing project patterns unless the task specifically requires changing them.

## Backwards Compatibility

- Do not preserve backwards compatibility, legacy interfaces, aliases, migrations, or deprecation shims unless the affected behavior has already been deployed to mainnet or the user explicitly requests compatibility.
- For pre-mainnet code, prefer the clean breaking change and update all affected contracts, applications, tests, documentation, deployment tooling, and generated artifacts together.

## Communicate Concisely

- Keep progress updates and final responses concise and focused on useful outcomes.
- Do not add lengthy explanations, excessive formatting, or unnecessary detail unless requested.
- Mention important assumptions, risks, verification performed, and anything still unresolved.

## Documentation

When creating or substantially rewriting documentation:

1. Inspect the relevant implementation and existing documentation before writing.
2. Use the `deslop` skill for prose and style guidance.
3. Do not automatically load all deslop reference files. Read individual reference files only when they are useful for the current task.
4. Keep technical claims grounded in the implementation or existing authoritative documentation. Do not guess protocol behavior.
5. Run Slopless only on documentation files changed in the current task.
6. Review Slopless findings intelligently and fix legitimate findings. Do not sacrifice technical accuracy or clarity merely to satisfy the linter.
7. Rerun Slopless after revisions.

For small factual, formatting, or typographical documentation edits, use judgment and do not invoke the full workflow unnecessarily.

## User-facing copy

When creating or substantially rewriting user-facing prose, use the `deslop` skill for style guidance.
This includes onboarding copy, explanatory text, empty states, modal content, help text, and other substantial UI copy.
Do not invoke the full documentation workflow for ordinary microcopy such as button labels, field labels, short tooltips, validation messages, or similarly small strings. For these, prioritize clarity, brevity, consistency, and accurate terminology.
Run Slopless only when a task introduces or substantially rewrites enough user-facing prose for linting to be useful. Do not run it for isolated UI strings.

## Solidity Verification

- After editing any Solidity file, run `forge fmt` and then `forge fmt --check` from `contracts/` before handing the work back. Check the whole directory, including tests and fork tests. If formatting still fails, rerun the formatter and check until it passes.
- Use the Foundry version pinned in `.github/workflows/solidity-security.yml`.
- After formatting production Solidity changes, run `forge lint src --deny warnings` from `contracts/` and `corepack pnpm contracts:security` from the repository root. Formatting can move casts away from their line-specific lint annotations; fix those annotations without removing the underlying safety checks.
- Run tests appropriate to behavior changes. Fix verification failures before declaring the task complete; if a required check cannot run, state what blocked it.

## Browser Testing

- Prefer the Codex in-app browser for local development, UI inspection, and browser-based testing.
- Use the user's Chrome browser only when they explicitly request Chrome or the task depends on existing Chrome tabs, authenticated sessions, or extensions.
- If a local page fails in the in-app browser, check the development server before switching browsers.

## Git Commits

- Do not create, amend, or otherwise modify Git commits unless the user explicitly asks for it.
- Leave completed work uncommitted by default.
