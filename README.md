# MCP Gateway

**One connection between your AI assistant and every enterprise tool — with identity, RBAC, and routing built in.**

Today, plugging Claude / Copilot / OpenAI into Jira, GitHub, Firebase and Figma means N independent connections, each with its own credentials and no concept of *who* is asking. Anyone with the client config can call anything. MCP Gateway collapses those N connections into one and enforces per-user permissions in front of every backend, so you can let `dev` accounts read freely but block writes to production systems without touching each tool individually.

---

## The Problem It Solves

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

### When a Backend is Unreachable

Backends connect in the background after startup, so the gateway never blocks the AI client on a slow or broken service:

- **One backend fails to start** — the gateway logs `[gateway] backend "<name>" failed to connect: <reason>` to stderr and continues. Other backends are unaffected. Tools from the failed backend simply do not appear in `tools/list`.
- **Initial connect is slow** — `tools/list` waits up to 25 seconds (`BACKENDS_READY_TIMEOUT_MS`) for the first connect round, then returns whatever is ready. Late arrivals are pushed via `tools/list_changed`.
- **A backend dies mid-session** — calls to its tools will fail at request time and surface the underlying error to the AI client. The gateway does not currently auto-reconnect; restart it to recover.

The gateway itself only fails to start if Firestore initialization fails (see [Troubleshooting](#troubleshooting)) — every backend error is non-fatal.

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

### How "write" is detected

The gateway has no per-backend tool catalog. Instead it pattern-matches the tool name against a single regex of write verbs:

```
create | update | delete | edit | add | remove | send | post | reply |
comment | assign | close | reopen | resolve | transition | move |
publish | archive | rename | import | invite | approve | reject |
merge | write
```

A tool is classified as a write if its name (after the backend prefix) contains any of these verbs as a token — e.g. `github_create_pull_request` → write, `atlassian_searchJiraIssuesUsingJql` → read.

### Known limitations of this approach

- **Verbs in noun position are still treated as writes.** `*_delete_status` or `*_create_template_list` will be blocked for `dev` even if the tool is read-only. Conversely, a hypothetical `*_clobber_database` would slip through because `clobber` isn't in the verb list.
- **Backends that don't follow `verb_noun` naming may misclassify.** Most MCP servers do follow the convention, but third-party backends are free to do otherwise.
- **No per-tool override exists today.** You cannot currently allowlist or blocklist a specific tool by name in `gateway.config.json`. If you hit a misclassification you have two options: rename the tool upstream, or run two separate gateway processes with different role assignments. A config escape hatch (`overrides: { write: [...], read: [...] }`) is on the roadmap — see [issues](https://github.com/rohitjb/mcp-gateway/issues) to track or +1.

The verb regex lives in [`src/gateway/rbac.ts`](src/gateway/rbac.ts) if you want to fork and customize it.

---

## Security Model & Limitations

The gateway is designed for **trusted, identified developers inside a single organization** — not for untrusted multi-tenant or public exposure. Be explicit with yourself about what it does and does not give you:

### What the gateway provides

- A single chokepoint for tool access, so revoking a backend (rotating a GitHub PAT, removing a Figma key) instantly cuts off every AI client at once.
- Per-user RBAC enforced server-side, with role assignments stored centrally in Firestore.
- A consistent audit surface (stderr today; structured logs are on the roadmap) for every tool call routed through it.

### What it does not provide (yet)

- **Identity is self-reported.** The caller's email comes from the `GATEWAY_USER_EMAIL` env var, `git config --global user.email`, or `gh api user` — in that order. None of these are cryptographically verified. Any user with shell access to the host can claim to be anyone whose email exists in Firestore. This is acceptable when every developer runs the gateway in their own local process under their own OS user, but **it is not acceptable as a hosted multi-tenant service** without an additional identity layer.
- **No request-level authentication on the hosted HTTP transport.** If you deploy the gateway to Cloud Run and expose `/mcp` publicly, anyone who can reach it can send `GATEWAY_USER_EMAIL` headers. Put it behind an IAP, OIDC proxy, or VPN until proper auth lands.
- **No audit log persistence.** Tool calls are written to stderr only. Plumbing them to a durable sink (BigQuery, Cloud Logging, etc.) is on the roadmap.
- **Verb-based RBAC is heuristic, not exhaustive.** See the [limitations above](#known-limitations-of-this-approach).
- **No rate limiting or quota enforcement** between the AI client and backends.

### Recommended deployment posture today

Local-per-developer (the default in this README) is the safest model: each developer runs their own gateway process, their OS account gates `git config`, and there's no shared attack surface. Use the hosted/cloud variant only behind an existing trust boundary (corporate VPN, IAP-protected Cloud Run service, etc.) until verified identity is implemented.

---

## Troubleshooting

### Firestore auth failures

**Symptom:** Gateway exits at startup with `Could not load the default credentials` or `permission denied on projects/<id>`.

- Run `pnpm exec tsx src/index.ts login` once to populate Application Default Credentials. The login command opens a browser and stores credentials in `~/.config/gcloud/application_default_credentials.json`.
- Confirm the project ID in `gateway.config.json` matches a project your Google account has at least `roles/datastore.user` on.
- If running in CI or a headless environment, set `GOOGLE_APPLICATION_CREDENTIALS` to a service account key file with Firestore access instead.
- Verify the `users` collection exists in Firestore and that your email has a document with `{ role: "dev" | "lead" }`. The gateway throws on first tool call if your email isn't found.

### A backend never appears in `tools/list`

**Symptom:** `search_all` works but tools from a specific backend (e.g. `github_*`) are missing.

- Check the gateway's stderr. Backend failures log as `[gateway] backend "<name>" failed to connect: <reason>`.
- For **stdio** backends, the most common cause is a missing or invalid token in the `env` block of `gateway.config.json` (e.g. an expired `GITHUB_PERSONAL_ACCESS_TOKEN`).
- For **HTTP/OAuth** backends (Atlassian, Miro, Teams), the first connection opens a browser for consent. If you run the gateway under a process supervisor with no display, OAuth will hang and time out after 25 seconds. Run `pnpm dev` interactively once to complete the OAuth flow; tokens are then cached for subsequent runs.
- For **local HTTP** backends (Figma), check that `lsof -ti :<port>` is free before startup — the gateway will kill the existing process, but only if it has permission.

### Tool call returns `Access denied: write operations require lead role`

The gateway is doing its job — your Firestore role is `dev`. Either change your document to `{ role: "lead" }`, or accept that this tool is correctly write-classified. If you believe the classification is wrong, see [Known limitations](#known-limitations-of-this-approach).

### Identity not found at tool-call time

**Symptom:** `Identity not found. Set GATEWAY_USER_EMAIL or configure git user.email.`

Set the env var explicitly in your AI client config:

```json
"env": { "GATEWAY_USER_EMAIL": "you@company.com" }
```

This is also the right knob for testing as a different role without re-editing git config.

---

## Contributing & Roadmap

The repo is at v0.1.0 — the bones are solid, but several areas are explicitly open for contribution. See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow, and the [pinned issues](https://github.com/rohitjb/mcp-gateway/issues) for in-flight work. Headline roadmap items:

- **Verified identity** — replace self-reported email with OIDC token validation, so the hosted deployment is safe outside a VPN.
- **Audit log persistence** — structured per-call logs to BigQuery / Cloud Logging.
- **RBAC config overrides** — explicit per-tool allow/block lists for the verb classifier's misses.
- **More backends** — Slack, Linear, Notion, Sentry. Adding one is a single block in `gateway.config.json` plus an entry in the [Supported Backends](#supported-backends) table.

If any of these match what you want to build, open an issue first so we can sanity-check scope before you invest in a PR.

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
