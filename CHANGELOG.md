# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to adhere to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Docker Compose quickstart** — `docker compose up` boots the gateway against a local Firestore emulator with a bundled mock backend (one read tool, one write tool), so evaluators can see RBAC blocking a write without provisioning a real GCP project or backend tokens. See the new "Try it in 30 Seconds" section in the README.
- **Firestore emulator support in `initFirestore`** — when `FIRESTORE_EMULATOR_HOST` is set, the gateway skips real credentials and routes all queries to the emulator. Useful for CI integration tests and local dev, not just the docker quickstart.
- **Mock stdio MCP backend** under `docker/mock-backend/` — minimal example of a backend the gateway can talk to. Doubles as a reference for anyone writing their own.

### Fixed

- **README RBAC schema documentation** — the "Add users to Firestore" section described the wrong shape (`users/{email} → { role }`). The code has always read `rbac/config → { dev: [emails], leads: [emails] }`; docs now match.
- **Smart router missed miro entirely** — `KNOWN_BACKENDS` in `src/router/classify.ts` was hardcoded to five backends and never included `miro`, so `search_all` would never route queries there even when miro was configured. Added miro with whiteboard/sticky/brainstorm keywords.
- **Stale classify test** — `src/router/classify.tests.ts` asserted four backends in the "no keywords match" fallback after `figma` had been added (now expects six with the miro fix above).

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
