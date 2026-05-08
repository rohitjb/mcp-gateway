# Proxy + RBAC Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the direct-OAuth auth system with a pure proxy layer that spawns existing MCP servers as child processes and adds RBAC on top.

**Architecture:** `gateway.config.json` lists backend MCP servers (command + args + env). At startup the gateway spawns each server via stdio, discovers their tools, and exposes them with RBAC gating from Firestore. The `auth` command and all OAuth flows are removed entirely.

**Tech Stack:** `@modelcontextprotocol/sdk` (Client + StdioClientTransport), `firebase-admin`, `commander`, `vitest`

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `src/gateway/mcpClient/index.ts` | Spawn a backend MCP server and return a `BackendClient` |
| Create | `src/gateway/mcpClient/tests.ts` | Unit tests for `connectMcpClient` |
| Modify | `src/rbac/firestore.ts` | Replace `integrations` with `backends: Record<string, BackendConfig>` in `GatewayConfig` |
| Modify | `src/identity/detect.ts` | Remove `readTokensFile` dep; add `GATEWAY_USER_EMAIL` env var as first check |
| Modify | `src/identity/tests.ts` | Remove token-file tests; add env-var test; update error message |
| Modify | `src/types.ts` | Remove `TokenFile`; strip `githubUsername` from `Identity` |
| Modify | `src/index.ts` | Remove `auth` command + OAuth env vars; wire backends from config |
| Delete | `src/auth/` | Entire directory removed |

---

## Task 1: Add BackendConfig to GatewayConfig

**Files:**
- Modify: `src/rbac/firestore.ts:1-19`

- [ ] **Step 1: Update the config types**

Replace lines 1–19 of `src/rbac/firestore.ts` (the interfaces block) with:

```typescript
import { readFile } from 'node:fs/promises'
import type { Role } from './roleCache.js'

export interface BackendConfig {
  readonly command: string
  readonly args?: string[]
  readonly env?: Record<string, string>
}

export interface FirestoreConfig {
  readonly projectId: string
  readonly credentialsPath: string
}

export interface GatewayConfig {
  readonly firebase: FirestoreConfig
  readonly backends: Record<string, BackendConfig>
  readonly router?: {
    readonly model?: string
  }
}
```

The rest of the file (`loadGatewayConfig`, `makeFetchRoleFromFirestore`) stays unchanged.

- [ ] **Step 2: Verify typecheck passes**

Run: `pnpm check`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/rbac/firestore.ts
git commit -m "feat: replace integrations with backends map in GatewayConfig"
```

---

## Task 2: Create McpClient module

**Files:**
- Create: `src/gateway/mcpClient/index.ts`
- Create: `src/gateway/mcpClient/tests.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/gateway/mcpClient/tests.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BackendConfig } from '../../rbac/firestore.js'

const makeMockClient = (tools: Tool[], callResult: CallToolResult) => ({
  connect: vi.fn().mockResolvedValue(undefined),
  listTools: vi.fn().mockResolvedValue({ tools }),
  callTool: vi.fn().mockResolvedValue(callResult),
})

const config: BackendConfig = { command: 'npx', args: ['some-mcp-server'] }

describe('connectMcpClient', () => {
  it('connects to the transport on creation', async () => {
    const { connectMcpClient } = await import('./index.js')
    const mockClient = makeMockClient([], { content: [] })
    const mockTransport = {}
    await connectMcpClient(config, {
      makeClient: () => mockClient as never,
      makeTransport: () => mockTransport as never,
    })
    expect(mockClient.connect).toHaveBeenCalledWith(mockTransport)
  })

  it('listTools returns the tools from the underlying client', async () => {
    const { connectMcpClient } = await import('./index.js')
    const tools: Tool[] = [
      { name: 'search_issues', description: 'Search issues', inputSchema: { type: 'object', properties: {} } },
    ]
    const mockClient = makeMockClient(tools, { content: [] })
    const backend = await connectMcpClient(config, {
      makeClient: () => mockClient as never,
      makeTransport: () => ({}) as never,
    })
    const result = await backend.listTools()
    expect(result).toEqual(tools)
  })

  it('callTool delegates to the underlying client with name and arguments', async () => {
    const { connectMcpClient } = await import('./index.js')
    const callResult: CallToolResult = { content: [{ type: 'text', text: 'ok' }] }
    const mockClient = makeMockClient([], callResult)
    const backend = await connectMcpClient(config, {
      makeClient: () => mockClient as never,
      makeTransport: () => ({}) as never,
    })
    const result = await backend.callTool('search_issues', { query: 'open bugs' })
    expect(mockClient.callTool).toHaveBeenCalledWith({
      name: 'search_issues',
      arguments: { query: 'open bugs' },
    })
    expect(result).toEqual(callResult)
  })

  it('passes the config to makeTransport', async () => {
    const { connectMcpClient } = await import('./index.js')
    const mockClient = makeMockClient([], { content: [] })
    let capturedConfig: BackendConfig | undefined
    await connectMcpClient(config, {
      makeClient: () => mockClient as never,
      makeTransport: (c) => { capturedConfig = c; return {} as never },
    })
    expect(capturedConfig).toBe(config)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/gateway/mcpClient/tests.ts`
Expected: FAIL — `Cannot find module './index.js'`

- [ ] **Step 3: Implement connectMcpClient**

Create `src/gateway/mcpClient/index.ts`:

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BackendClient } from '../registry.js'
import type { BackendConfig } from '../../rbac/firestore.js'

interface SdkClient {
  connect(transport: unknown): Promise<void>
  listTools(): Promise<{ tools: Tool[] }>
  callTool(params: { name: string; arguments: Record<string, unknown> }): Promise<CallToolResult>
}

interface McpClientDeps {
  makeClient: () => SdkClient
  makeTransport: (config: BackendConfig) => unknown
}

const productionDeps = (config: BackendConfig): McpClientDeps => ({
  makeClient: () => new Client({ name: 'mcp-gateway', version: '0.1.0' }) as SdkClient,
  makeTransport: (c) =>
    new StdioClientTransport({
      command: c.command,
      args: c.args ?? [],
      env: c.env ? { ...process.env, ...c.env } : undefined,
    }),
})

export const connectMcpClient = async (
  config: BackendConfig,
  deps: McpClientDeps = productionDeps(config),
): Promise<BackendClient> => {
  const client = deps.makeClient()
  const transport = deps.makeTransport(config)
  await client.connect(transport)

  return {
    listTools: async () => {
      const { tools } = await client.listTools()
      return tools
    },
    callTool: (name, args) =>
      client.callTool({ name, arguments: args }),
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/gateway/mcpClient/tests.ts`
Expected: PASS — 4 tests

- [ ] **Step 5: Commit**

```bash
git add src/gateway/mcpClient/index.ts src/gateway/mcpClient/tests.ts
git commit -m "feat: add McpClient that spawns backend MCP servers over stdio"
```

---

## Task 3: Simplify identity detection

**Files:**
- Modify: `src/types.ts`
- Modify: `src/identity/detect.ts`
- Modify: `src/identity/tests.ts`

- [ ] **Step 1: Update Identity type**

Replace `src/types.ts` with:

```typescript
export interface Identity {
  email: string
}
```

(`githubUsername` was only written by the GitHub OAuth flow, which is being removed.)

- [ ] **Step 2: Write the updated failing tests**

Replace `src/identity/tests.ts` with:

```typescript
import { describe, it, expect, vi } from 'vitest'
import type { DetectDeps } from './detect.js'

const makeExec =
  (map: Record<string, string>): DetectDeps['exec'] =>
  async (cmd, args) => {
    const key = [cmd, ...args].join(' ')
    const value = map[key]
    if (value === undefined) throw new Error(`exec: command not found: ${key}`)
    return value
  }

describe('detectIdentity', () => {
  it('returns email from GATEWAY_USER_EMAIL env var when set', async () => {
    vi.stubEnv('GATEWAY_USER_EMAIL', 'env@example.com')
    const { detectIdentity } = await import('./detect.js')
    const result = await detectIdentity({ exec: makeExec({}) })
    expect(result.email).toBe('env@example.com')
    vi.unstubAllEnvs()
  })

  it('falls through to git config when GATEWAY_USER_EMAIL is not set', async () => {
    vi.stubEnv('GATEWAY_USER_EMAIL', '')
    const { detectIdentity } = await import('./detect.js')
    const result = await detectIdentity({
      exec: makeExec({ 'git config --global user.email': 'git@example.com\n' }),
    })
    expect(result.email).toBe('git@example.com')
    vi.unstubAllEnvs()
  })

  it('falls through to gh api when git config is empty', async () => {
    vi.stubEnv('GATEWAY_USER_EMAIL', '')
    const { detectIdentity } = await import('./detect.js')
    const result = await detectIdentity({
      exec: makeExec({
        'git config --global user.email': '',
        'gh api user --jq .email': '"gh@example.com"\n',
      }),
    })
    expect(result.email).toBe('gh@example.com')
    vi.unstubAllEnvs()
  })

  it('falls through to gh api when git config throws', async () => {
    vi.stubEnv('GATEWAY_USER_EMAIL', '')
    const { detectIdentity } = await import('./detect.js')
    const result = await detectIdentity({
      exec: makeExec({ 'gh api user --jq .email': '"gh@example.com"' }),
    })
    expect(result.email).toBe('gh@example.com')
    vi.unstubAllEnvs()
  })

  it('throws when all sources fail', async () => {
    vi.stubEnv('GATEWAY_USER_EMAIL', '')
    const { detectIdentity } = await import('./detect.js')
    await expect(
      detectIdentity({ exec: makeExec({}) }),
    ).rejects.toThrow('Identity not found. Set GATEWAY_USER_EMAIL or configure git user.email.')
    vi.unstubAllEnvs()
  })

  it('skips gh api "null" response and throws', async () => {
    vi.stubEnv('GATEWAY_USER_EMAIL', '')
    const { detectIdentity } = await import('./detect.js')
    await expect(
      detectIdentity({
        exec: makeExec({
          'git config --global user.email': '',
          'gh api user --jq .email': 'null',
        }),
      }),
    ).rejects.toThrow('Identity not found. Set GATEWAY_USER_EMAIL or configure git user.email.')
    vi.unstubAllEnvs()
  })
})
```

- [ ] **Step 3: Run tests to see them fail**

Run: `pnpm test src/identity/tests.ts`
Expected: FAIL — type errors on old `readTokensFile` dep and old error message

- [ ] **Step 4: Update detect.ts**

Replace `src/identity/detect.ts` with:

```typescript
import type { Identity } from '../types.js'

export interface DetectDeps {
  exec: (cmd: string, args: string[]) => Promise<string>
}

const stripJsonQuotes = (value: string): string => {
  const trimmed = value.trim()
  return trimmed.startsWith('"') && trimmed.endsWith('"')
    ? trimmed.slice(1, -1)
    : trimmed
}

export const detectIdentity = async (deps: DetectDeps): Promise<Identity> => {
  // 1. Env var — simplest path for local dev and CI
  const envEmail = process.env['GATEWAY_USER_EMAIL']?.trim()
  if (envEmail) return { email: envEmail }

  // 2. git config --global user.email
  try {
    const email = (await deps.exec('git', ['config', '--global', 'user.email'])).trim()
    if (email) return { email }
  } catch {
    // git not installed or no email configured — fall through
  }

  // 3. gh api user --jq .email
  try {
    const raw = (await deps.exec('gh', ['api', 'user', '--jq', '.email'])).trim()
    const email = stripJsonQuotes(raw)
    if (email && email !== 'null') return { email }
  } catch {
    // gh not installed or not authenticated — fall through
  }

  throw new Error('Identity not found. Set GATEWAY_USER_EMAIL or configure git user.email.')
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test src/identity/tests.ts`
Expected: PASS — 6 tests

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/identity/detect.ts src/identity/tests.ts
git commit -m "feat: simplify identity detection — env var + git fallback, remove token file dep"
```

---

## Task 4: Wire backends in index.ts and remove auth command

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Replace src/index.ts**

Replace the entire file with:

```typescript
import { Command } from 'commander'
import { detectIdentity } from './identity/detect.js'
import { execFile } from './utils/exec.js'
import { makeGetUserRole } from './rbac/index.js'
import { RoleCache } from './rbac/roleCache.js'
import { loadGatewayConfig, makeFetchRoleFromFirestore } from './rbac/firestore.js'
import { checkAccess } from './gateway/rbac.js'
import { ToolRegistry } from './gateway/registry.js'
import { connectMcpClient } from './gateway/mcpClient/index.js'
import { searchAll } from './router/index.js'
import { classify } from './router/classify.js'
import { startGatewayServer } from './gateway/server.js'
import { resolve } from 'node:path'
import type { BackendClient } from './gateway/registry.js'

export const dispatch = async (args: string[]): Promise<void> => {
  const program = new Command()

  program
    .name('mcp-gateway')
    .description('MCP gateway with RBAC for enterprise tool access')
    .version('0.1.0')

  program
    .command('serve', { isDefault: true })
    .description('Start the MCP gateway server (stdio transport)')
    .option('--config <path>', 'Path to gateway.config.json', './gateway.config.json')
    .action(async (opts: { config: string }) => {
      const configPath = resolve(opts.config)
      const config = await loadGatewayConfig(configPath)

      const cache = new RoleCache()
      const fetchRole = makeFetchRoleFromFirestore(config.firebase)
      const getUserRole = makeGetUserRole({ fetchRole, cache })

      const backends: Record<string, BackendClient> = {}
      for (const [name, backendConfig] of Object.entries(config.backends)) {
        backends[name] = await connectMcpClient(backendConfig)
      }

      const registry = new ToolRegistry({ backends })
      await registry.initialize()

      const classifyFn = (query: string) => Promise.resolve(classify(query))

      const callBackendSearch = (backend: string, query: string) =>
        registry.callTool(`${backend}_search_issues`, { query }).catch(() =>
          registry.callTool(`${backend}_search`, { query }),
        )

      await startGatewayServer({
        registry,
        detectIdentity: () => detectIdentity({ exec: execFile }),
        getUserRole,
        checkAccess,
        searchAll: query => searchAll(query, { classify: classifyFn, callBackendSearch }),
      })
    })

  await program.parseAsync(['node', 'mcp-gateway', ...args])
}

const isMain = process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js')

if (isMain) {
  dispatch(process.argv.slice(2)).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
```

- [ ] **Step 2: Verify typecheck and all tests pass**

Run: `pnpm check && pnpm test`
Expected: all tests pass, no type errors

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire McpClient backends from config, remove auth command"
```

---

## Task 5: Delete auth directory and clean up

**Files:**
- Delete: `src/auth/` (entire directory)

- [ ] **Step 1: Delete the auth directory**

```bash
rm -rf src/auth
```

- [ ] **Step 2: Run full check to confirm nothing broke**

Run: `pnpm check && pnpm test`
Expected: all tests pass, no type errors, no lint warnings

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove auth directory and all OAuth flows"
```

---

## Task 6: Add example config

**Files:**
- Create: `gateway.config.example.json`

- [ ] **Step 1: Create example config**

Create `gateway.config.example.json`:

```json
{
  "firebase": {
    "projectId": "your-firebase-project-id",
    "credentialsPath": "/Users/you/.mcp-gateway/firebase-service-account.json"
  },
  "backends": {
    "atlassian": {
      "command": "npx",
      "args": ["@atlassian/mcp-server-jira"]
    },
    "github": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "your-token-here"
      }
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add gateway.config.example.json
git commit -m "docs: add gateway.config.example.json for proxy-based setup"
```
