# MCP Gateway

**A universal security and routing layer for enterprise AI tool access.**

MCP Gateway sits between your AI assistant (Claude, GitHub Copilot, OpenAI) and every enterprise service it needs to reach. Instead of giving your AI client a direct, unchecked connection to Jira, GitHub, Figma, and Firebase, you give it one connection — to the gateway. The gateway handles identity, permissions, and routing.

---

## The Problem It Solves

Modern AI assistants can call tools. Without a gateway, each tool connection is independent: your AI client gets raw access to every service, with no concept of who is asking, what they are allowed to do, or which service should handle a given request.

```
Without Gateway                      With MCP Gateway
─────────────────                    ────────────────────────────────────────

  AI Client                            AI Client
     │                                    │
     ├──── Atlassian ✗ (no auth check)    │        ┌─────────────────────────┐
     ├──── GitHub    ✗ (no auth check)    └───────▶│      MCP Gateway        │
     ├──── Firebase  ✗ (no auth check)             │  ┌────────────────────┐ │
     └──── Figma     ✗ (no auth check)             │  │ Identity Detection │ │
                                                   │  │ RBAC (Firestore)   │ │
                                                   │  │ Smart Router       │ │
                                                   │  └────────────────────┘ │
                                                   └───┬─────┬──────┬────────┘
                                                       │     │      │
                                                   Atlassian  │   Figma
                                                          GitHub
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              AI Client                                      │
│               (Claude Desktop / GitHub Copilot / OpenAI)                   │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │  MCP (stdio or HTTP)
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            MCP Gateway                                      │
│                                                                             │
│  ┌───────────────────┐   ┌──────────────────┐   ┌─────────────────────┐   │
│  │  Identity Layer   │   │   RBAC Engine    │   │   Smart Router      │   │
│  │                   │   │                  │   │                     │   │
│  │ Reads who is      │──▶│ Fetches role     │   │ Classifies natural  │   │
│  │ calling from env  │   │ from Firestore   │   │ language queries    │   │
│  │ var or git config │   │                  │   │ to the right        │   │
│  │                   │   │ dev  → read-only │   │ backend by keyword  │   │
│  │ email@company.com │   │ lead → read+write│   │ scoring             │   │
│  └───────────────────┘   └──────────────────┘   └─────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                       Tool Registry                                 │   │
│  │                                                                     │   │
│  │  Aggregates tools from all backends under namespaced names:        │   │
│  │  atlassian_search_issues  │  github_create_pr  │  figma_get_file   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└──────┬──────────────┬──────────────┬──────────────┬────────────────┬───────┘
       │              │              │              │                │
       ▼              ▼              ▼              ▼                ▼
  ┌─────────┐   ┌──────────┐  ┌──────────┐  ┌──────────┐   ┌──────────────┐
  │Atlassian│   │  GitHub  │  │ Firebase │  │   Miro   │   │   Teams /    │
  │  (MCP)  │   │  (MCP)   │  │  (MCP)   │  │  (MCP)   │   │   Figma /    │
  │  OAuth  │   │   PAT    │  │   ADC    │  │  OAuth   │   │   others...  │
  └─────────┘   └──────────┘  └──────────┘  └──────────┘   └──────────────┘

  ┌────────────────────────────────────────┐
  │           Firebase Firestore           │
  │  (role store: email → dev | lead)      │
  └────────────────────────────────────────┘
```

### How a Tool Call Flows

1. **AI client** sends a `tools/call` request to the gateway over stdio (or HTTP if hosted).
2. **Identity layer** resolves who is calling — reads `MCP_GATEWAY_EMAIL` env var, or falls back to `git config user.email`.
3. **RBAC engine** fetches that user's role from Firestore (`dev` or `lead`).
4. **Access check** — write operations (create, delete, update, etc.) are blocked for `dev` role. Read operations pass through unconditionally.
5. **Tool registry** routes the call to the correct backend by namespaced tool name (e.g. `atlassian_search_issues` → Atlassian backend).
6. **Backend** executes the call and returns the result upstream to the AI client.

The built-in `search_all` tool is special: it bypasses RBAC (always read-only), runs the query through the keyword classifier, and fans out to the most relevant backends automatically.

---

## Running Locally

### Prerequisites

| Requirement | Notes |
|-------------|-------|
| Node.js 20+ | LTS recommended |
| pnpm | `npm install -g pnpm` |
| Firebase project | For RBAC role storage |
| Google Cloud credentials | Run `gcloud auth application-default login` or use a service account key |

### 1. Install

```bash
git clone https://github.com/rohitjb/mcp-gateway
cd mcp-gateway
pnpm install
```

### 2. Authenticate with Google

The gateway reads user roles from Firestore. Authenticate once:

```bash
pnpm exec tsx src/index.ts login
```

This opens a browser to complete Google OAuth and stores Application Default Credentials locally.

### 3. Configure backends

Copy the example config and fill in your services:

```bash
cp gateway.config.example.json gateway.config.json
```

```jsonc
{
  "firebase": {
    "projectId": "your-firebase-project-id"
  },
  "backends": {
    "atlassian": {
      "command": "npx",
      "args": ["-y", "mcp-remote@latest", "https://mcp.atlassian.com/v1/mcp/authv2"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_your_token_here"
      }
    },
    "firebase": {
      "command": "npx",
      "args": ["-y", "firebase-tools@latest", "mcp"]
    },
    "miro": {
      "command": "npx",
      "args": ["-y", "mcp-remote@latest", "https://mcp.miro.com/"]
    }
  }
}
```

Each backend is one of three transport types:

| Type | When to use | Example |
|------|------------|---------|
| **stdio** | Backend is a local npm package | GitHub, Firebase |
| **HTTP** | Backend is a hosted MCP endpoint | Atlassian, Miro, Teams |
| **Local HTTP** | Backend speaks HTTP but must be spawned locally | Figma |

### 4. Add users to Firestore

In your Firebase console, create a collection named `users`. Each document is keyed by email:

```
users/
  alice@company.com   →  { role: "lead" }
  bob@company.com     →  { role: "dev" }
```

`lead` — full read + write access to all tools  
`dev` — read-only; write operations are blocked at the gateway

### 5. Wire it into your AI client

**Claude Desktop** — add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mcp-gateway": {
      "command": "npx",
      "args": ["tsx", "/path/to/mcp-gateway/src/index.ts", "serve", "--config", "/path/to/gateway.config.json"]
    }
  }
}
```

**Claude Code** — add a `.mcp.json` at the project root:

```json
{
  "mcpServers": {
    "mcp-gateway": {
      "type": "stdio",
      "command": "pnpm",
      "args": ["exec", "tsx", "src/index.ts", "serve", "--config", "./gateway.config.json"]
    }
  }
}
```

**GitHub Copilot** — add the same `command` / `args` block under `github.copilot.mcp.servers` in VS Code settings.

### 6. Start the gateway

Development (auto-reloads on file changes):

```bash
pnpm dev
```

Production:

```bash
pnpm build && pnpm start
```

The gateway starts immediately and connects to backends in the background. Tools become available as each backend comes online — your AI client does not need to wait.

---

## Cloud Hosting — One Link for the Whole Team

When the gateway runs locally, every developer manages their own process, config file, and credentials. When you host the gateway on a cloud service (Cloud Run, Railway, Fly.io, etc.), the team shares a single deployment and you hand each person a URL instead of a binary.

```
Local setup (per developer)          Cloud setup (team-wide)
───────────────────────────          ──────────────────────────────────────

  Developer A                          Developer A ──┐
  ├── gateway process                                │
  ├── gateway.config.json                            ▼
  └── ADC credentials              https://mcp-gateway.your-company.com
                                                     ▲
  Developer B                          Developer B ──┘
  ├── gateway process
  ├── gateway.config.json           No cloning. No credentials.
  └── ADC credentials               No local processes.
```

Each developer's AI client config becomes a single line:

```json
{
  "mcpServers": {
    "gateway": {
      "type": "http",
      "url": "https://mcp-gateway.your-company.com/mcp"
    }
  }
}
```

New backends are added once by an admin and become available to the whole team immediately. Identity and RBAC are enforced server-side — the gateway knows who is calling from the request context.

---

## Supported Backends

| Service | Transport | Auth |
|---------|-----------|------|
| Atlassian (Jira, Confluence) | HTTP via `mcp-remote` | OAuth (browser) |
| GitHub | stdio | Personal Access Token |
| Firebase | stdio | Google ADC |
| Miro | HTTP via `mcp-remote` | OAuth (browser) |
| Microsoft Teams | HTTP via `mcp-remote` | OAuth (Microsoft) |
| Figma | Local HTTP/SSE | API Key |

Adding a new backend requires a single entry in `gateway.config.json` — no code changes.

---

## Role-Based Access Control

Roles are stored per-user in Firestore and cached in memory to avoid redundant lookups.

| Role | Read tools | Write tools |
|------|-----------|-------------|
| `lead` | ✅ | ✅ |
| `dev` | ✅ | ❌ |

Write operations are identified automatically by verb in the tool name — `create`, `update`, `delete`, `edit`, `send`, `post`, `comment`, `assign`, `close`, `merge`, `publish`, and others are all treated as writes. No per-backend configuration needed.

---

## Commands

```bash
pnpm dev                                    # Development mode (tsx, auto-reload)
pnpm build                                  # Compile to dist/ (tsup → ESM)
pnpm start                                  # Run compiled build
pnpm test                                   # Run tests (vitest)
pnpm check                                  # Format, lint, typecheck

pnpm exec tsx src/index.ts login            # Authenticate with Google (run once)
pnpm exec tsx src/index.ts serve            # Start gateway (default command)
pnpm exec tsx src/index.ts serve \
  --config /path/to/gateway.config.json     # Use a specific config file
```

---

## Repository

[github.com/rohitjb/mcp-gateway](https://github.com/rohitjb/mcp-gateway)
