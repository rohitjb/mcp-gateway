# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to adhere to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_No unreleased changes yet._

## [0.1.0] — 2026-05-18

First tagged release. The project has been usable for several iterations; this tag marks the point at which the core surface (identity → RBAC → routing) is stable enough to depend on.

### Added

- **Gateway core** — single MCP stdio endpoint that aggregates tools from multiple backends under namespaced names (`<backend>_<tool>`).
- **Identity detection** — resolves the caller's email from `GATEWAY_USER_EMAIL`, then `git config --global user.email`, then `gh api user`.
- **Firestore-backed RBAC** — per-user `dev` / `lead` roles cached in memory. Write operations (detected by verb in the tool name) are blocked for `dev`.
- **Smart router** — built-in `search_all` tool runs a keyword classifier over the query and fans out to the most relevant backends.
- **Backend transports** — stdio, hosted HTTP (via `mcp-remote`), and locally spawned HTTP/SSE.
- **OAuth provider** — handles the browser auth flow for HTTP backends (Atlassian, Miro, Teams) and caches tokens for reuse.
- **Background backend connect** — the gateway responds to `initialize` immediately and connects to backends in the background, with a 25 s ceiling on the initial `tools/list` wait.
- **`mcp-gateway login` command** — runs Google ADC login so the gateway can reach Firestore.

### Known limitations

These are documented up front rather than silently shipped — see the [Security Model & Limitations](README.md#security-model--limitations) section of the README.

- Caller identity is self-reported and not cryptographically verified.
- RBAC write detection is a pure regex on tool names; tools that don't follow `verb_noun` naming may misclassify.
- No per-tool override mechanism in `gateway.config.json` yet.
- Audit logging is stderr-only; no durable sink.
- The hosted HTTP transport has no request-level auth — deploy only behind a VPN or IAP-protected service.
