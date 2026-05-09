# Design: Microsoft Teams Backend

**Date:** 2026-05-09
**Status:** Approved

## Summary

Add Microsoft Teams as a backend in the MCP gateway using the official Microsoft-hosted Teams MCP server via `mcp-remote` OAuth. The router classifier and RBAC layer already support Teams; this change wires up the actual backend connection.

## Motivation

Teams is already referenced as a known backend in `src/router/classify.ts` and in the `search_all` tool description in `src/gateway/server.ts`. Adding the backend config completes the integration so Teams tools are available to gateway users with appropriate RBAC roles.

## Approach

Use the official Microsoft-hosted Teams MCP remote endpoint via `mcp-remote`, matching the same pattern as the existing Atlassian backend. OAuth is handled by `mcp-remote` via a browser flow on first connect.

Endpoint:
```
https://agent365.svc.cloud.microsoft/agents/tenants/{tenant_id}/servers/mcp_TeamsServer
```

## Changes

### 1. `gateway.config.example.json`

Add a `teams` entry to `backends`:

```json
"teams": {
  "command": "npx",
  "args": ["-y", "mcp-remote@latest", "https://agent365.svc.cloud.microsoft/agents/tenants/YOUR_TENANT_ID/servers/mcp_TeamsServer"]
}
```

The user replaces `YOUR_TENANT_ID` with their Azure AD tenant ID in their local `gateway.config.json`.

### 2. `docs/TRD.md`

Add Teams to the backends section, noting the tenant ID requirement and OAuth flow.

### 3. No other code changes needed

| Component | Status | Reason |
|---|---|---|
| `src/router/classify.ts` | No change | `teams` already a known backend with keywords |
| `src/gateway/rbac.ts` | No change | Write-verb regex covers Teams ops generically |
| `src/gateway/server.ts` | No change | `search_all` description already mentions Teams |
| `src/index.ts` | No change | Reads `backends` map dynamically — picks up `teams` automatically |
| `src/gateway/mcpClient/` | No change | Spawns any `BackendConfig` via stdio |

## Runtime Flow

1. Gateway starts, reads `gateway.config.json`
2. Sees `teams` key in `backends`, calls `connectMcpClient` with the config
3. `connectMcpClient` spawns `npx mcp-remote@latest <url>` via stdio
4. `mcp-remote` handles OAuth browser flow on first connect, caches token
5. Teams tools register in `ToolRegistry` alongside Atlassian tools
6. `classify.ts` routes `search_all` queries with Teams keywords to the Teams backend
7. RBAC blocks write operations (`send`, `post`, `reply`, etc.) for `dev` role users

## Prerequisites for Users

- Azure AD tenant ID
- Microsoft 365 work/school account with Teams access
- `npx` available (already required by other backends)

## Out of Scope

- Azure app registration (not required — the Microsoft-hosted endpoint handles auth)
- Channel/team filtering (the MCP server exposes tools for all accessible teams)
- Custom Teams MCP server deployment
