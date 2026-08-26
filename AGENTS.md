# Agent Guidelines

These instructions apply to the entire repository.

## Keep Changes Simple

- Do not overengineer. Prefer the smallest clear solution that fully addresses the request.
- Avoid unnecessary abstractions, speculative features, broad refactors, or unrelated cleanup.
- Follow existing project patterns unless the task specifically requires changing them.

## Communicate Concisely

- Keep progress updates and final responses concise and focused on useful outcomes.
- Do not add lengthy explanations, excessive formatting, or unnecessary detail unless requested.
- Mention important assumptions, risks, verification performed, and anything still unresolved.

## Browser Testing

- Prefer the Codex in-app browser for local development, UI inspection, and browser-based testing.
- Use the user's Chrome browser only when they explicitly request Chrome or the task depends on existing Chrome tabs, authenticated sessions, or extensions.
- If a local page fails in the in-app browser, check the development server before switching browsers.

## Git Commits

- Do not create, amend, or otherwise modify Git commits unless the user explicitly asks for it.
- Leave completed work uncommitted by default.
