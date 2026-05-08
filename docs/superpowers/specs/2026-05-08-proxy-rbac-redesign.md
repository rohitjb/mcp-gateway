# MCP Gateway: Proxy + RBAC Redesign

**Date:** 2026-05-08  
**Status:** Approved

## Problem

The current gateway implements its own OAuth flows for GitHub, Atlassian, and Teams, requiring OAuth client IDs/secrets that users already don't need — they already have those services configured as MCP servers in their `mcp.json`. The auth layer is unnecessary complexity.

## Design

The gateway becomes a pure proxy + RBAC layer. It:
1. Reads `gateway.config.json` to find backend MCP servers
2. Spawns each as a child process and connects via stdio
3. Discovers all tools from each backend at startup
4. Wraps every tool call with RBAC (role check via Firebase Firestore)
5. Exposes the combined tool surface over stdio to the AI client

## Config Format

`gateway.config.json`:
```json
{
  "firebase": { "serviceAccountPath": "/path/to/service-account.json" },
  "backends": {
    "atlassian": { "command": "npx", "args": ["@atlassian/mcp-server-jira"] },
    "github":    { "command": "npx", "args": ["@modelcontextprotocol/server-github"], "env": { "GITHUB_TOKEN": "..." } }
  }
}
```

Adding a new backend = one new entry. No code changes needed.

## Components

### `gateway/mcpClient` (new)
Implements `BackendClient` by spawning an MCP server as a child process and communicating via the MCP SDK's stdio client transport. Exposes `listTools()` and `callTool()`.

### `gateway/registry` (unchanged)
Already has the right abstraction. Gets wired with real `McpClient` instances instead of empty `{}`.

### `gateway/server` (unchanged)
RBAC + tool dispatch. No changes needed.

### `rbac/firestore` (updated)
Config loading updated to read `backends` map instead of per-service credentials.

### `index.ts` (updated)
- Remove `auth` command entirely
- `serve` command: load config → spawn `McpClient` per backend → init registry → start server
- Remove all OAuth env var reads

## What Gets Deleted

- `src/auth/` — entire directory (github.ts, atlassian.ts, teams.ts, firebaseAuth.ts, tokenFile.ts, index.ts, all tests)
- `src/identity/` — no longer needed (identity was used to map tokens to user; RBAC identity now comes from the MCP call context or a simpler mechanism)

Wait — identity/detect.ts is used by the serve command to detect who the user is for RBAC. Need to keep or replace this. The `detectIdentity` function reads the token file to get the user's email. Without the token file, we need another way.

**Revised:** Keep identity detection but simplify it — read from an env var (`MCP_GATEWAY_USER_EMAIL`) or a simple config field rather than a token file. The token file was a side-effect of the OAuth flows.

## Identity for RBAC

Without OAuth flows writing a token file, identity comes from:
- `GATEWAY_USER_EMAIL` env var (simplest, good for local dev)
- Alternatively, a `user` field in `gateway.config.json`

The `detectIdentity` function is updated to read from env var.

## Transport

stdio only (unchanged). HTTP/SSE for App Runner is a future extension.

## What Stays

- Firebase Firestore RBAC (`rbac/`) — unchanged
- `gateway/registry`, `gateway/server`, `gateway/rbac` — unchanged  
- `router/` (classify + searchAll) — unchanged
- stdio transport — unchanged
