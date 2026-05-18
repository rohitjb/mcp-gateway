# Contributing to MCP Gateway

Thanks for your interest. The repo is early (v0.1.0) and the surface area is small, which means individual contributions can move the project meaningfully. This document covers what's open, how to propose changes, and the workflow we follow.

## Where help is most useful right now

The [README roadmap](README.md#contributing--roadmap) lists the headline items. In rough priority order:

1. **Verified identity** — today the caller's email is self-reported via env var or `git config`. Replacing this with an OIDC validator (Google, Okta, GitHub) is the single biggest unlock for hosting the gateway as a shared service.
2. **Audit log sink** — every tool call is currently written to stderr. A structured emitter that can land in BigQuery / Cloud Logging / a file would make the gateway usable for compliance contexts.
3. **RBAC config overrides** — the verb regex in [`src/gateway/rbac.ts`](src/gateway/rbac.ts) misclassifies tools that don't follow `verb_noun` naming. An `overrides: { write: [...], read: [...] }` block in `gateway.config.json` would close the gap without a code change per backend.
4. **Additional backends** — Slack, Linear, Notion, Sentry, PagerDuty. Most are a single entry in `gateway.config.json` plus a row in the README's [Supported Backends](README.md#supported-backends) table.
5. **Docker quickstart** — a `docker-compose.yml` with the Firestore emulator and one stdio backend would shorten time-to-first-success from ~30 minutes to ~2.

Open an issue before starting on anything in the first three categories — these touch the security model and benefit from a quick design conversation. Items 4 and 5 are safe to PR directly.

## Workflow

1. **Open an issue** describing what you want to change and why. For roadmap items, link the relevant section above.
2. **Fork and branch.** Branch names are not enforced; descriptive is fine (`feature/oidc-identity`, `fix/figma-port-conflict`).
3. **Write or update tests.** The project uses Vitest. Tests live alongside source as `tests.ts` files inside each module directory (see [CLAUDE.md](CLAUDE.md) for the module-structure convention).
4. **Run the full check before pushing:**
   ```bash
   pnpm check     # format + lint + typecheck
   pnpm test      # vitest
   ```
   PRs that fail either are not reviewed until they pass.
5. **Open a PR** against `main`. Include a short summary of the change, the issue it closes, and any user-visible behavior shift that should land in [CHANGELOG.md](CHANGELOG.md).

## Code conventions

The full convention list is in [CLAUDE.md](CLAUDE.md). The highlights:

- TypeScript strict mode, ESM only, no `require()`.
- Each module is a directory with `index.ts`, optional `consts.ts`, `types.ts`, `tests.ts`. Never a flat `Foo.ts`.
- Use `pnpm`, not `npm` or `yarn`.
- Never log secrets — use `[REDACTED]` if you need to indicate a value exists.
- Type guards over `as` casts. See the CLAUDE.md section on type guards for the pattern.
- Tests verify behavior, not constant values.

## Reporting issues

When filing a bug, include:

- Output of `node --version` and `pnpm --version`.
- The relevant stderr from the gateway (it's noisy by design — that noise is the diagnostic).
- A redacted copy of the `backends` block from `gateway.config.json` if backend-specific.
- For RBAC issues, the tool name, the user's role in Firestore, and what you expected.

## License

By contributing, you agree that your contributions will be licensed under the MIT License (see [LICENSE](LICENSE) if present, otherwise per the `license` field in [package.json](package.json)).
