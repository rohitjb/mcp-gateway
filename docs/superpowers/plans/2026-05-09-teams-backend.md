# Microsoft Teams Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Microsoft Teams as a backend in `gateway.config.example.json` so users can connect to Teams via the official Microsoft-hosted MCP remote endpoint.

**Architecture:** The Teams backend uses the same `mcp-remote` OAuth pattern as Atlassian. At startup, `index.ts` reads the `teams` key from `backends`, spawns `npx mcp-remote@latest <url>` via stdio, and `mcp-remote` handles the OAuth browser flow. No code changes are needed — the router classifier, RBAC, server, and `mcpClient` already support Teams.

**Tech Stack:** `mcp-remote` (npm), Microsoft agent365 hosted MCP endpoint, `npx`

---

### Task 1: Add Teams backend to gateway.config.example.json

**Files:**
- Modify: `gateway.config.example.json`

The only change is adding a `teams` entry under `backends`. The URL uses the official Microsoft-hosted Teams MCP server. Users replace `YOUR_TENANT_ID` with their Azure AD tenant ID (found in Azure Portal → Azure Active Directory → Overview → Tenant ID).

- [ ] **Step 1: Update gateway.config.example.json**

Replace the entire file content with:

```json
{
  "firebase": {
    "projectId": "your-firebase-project-id",
    "credentialsPath": "/Users/you/.mcp-gateway/firebase-service-account.json"
  },
  "backends": {
    "atlassian": {
      "command": "npx",
      "args": ["-y", "mcp-remote@latest", "https://mcp.atlassian.com/v1/mcp/authv2"]
    },
    "github": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "your-token-here"
      }
    },
    "teams": {
      "command": "npx",
      "args": ["-y", "mcp-remote@latest", "https://agent365.svc.cloud.microsoft/agents/tenants/YOUR_TENANT_ID/servers/mcp_TeamsServer"]
    }
  }
}
```

- [ ] **Step 2: Run the check command to verify no regressions**

```bash
pnpm check
```

Expected: no errors, no type failures.

- [ ] **Step 3: Run tests to confirm nothing broke**

```bash
pnpm test
```

Expected: all tests pass (Teams routing tests in `src/router/classify.tests.ts` already pass — they were written in anticipation of this backend).

- [ ] **Step 4: Commit**

```bash
git add gateway.config.example.json
git commit -m "feat: add Microsoft Teams backend via mcp-remote"
```

---

## Notes for the user

After adding Teams to your local `gateway.config.json`:

1. Get your Azure tenant ID from [Azure Portal → Azure Active Directory → Overview](https://portal.azure.com)
2. Copy the `teams` block from `gateway.config.example.json` into your `gateway.config.json`
3. Replace `YOUR_TENANT_ID` with your actual tenant ID
4. Start the gateway — `mcp-remote` will open a browser for OAuth on first connect
5. Sign in with your Microsoft 365 work/school account

The gateway will then expose Teams tools (read channels, send messages, etc.) alongside Atlassian tools, all gated by the same RBAC rules.
