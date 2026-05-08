/**
 * Batch 7 — End-to-End Verification
 *
 * Wires all real module implementations together.
 * Only external I/O boundaries are mocked:
 *   - readTokensFile / exec  (identity detection)
 *   - fetchRole              (Firestore role lookup)
 *   - classify               (Haiku routing classifier)
 *   - callBackendSearch      (backend MCP tool calls via router)
 *   - BackendClient          (MCP backend servers via registry)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'

// Real module implementations under test
import { handleCallTool } from './gateway/server.js'
import { detectIdentity } from './identity/detect.js'
import { makeGetUserRole } from './rbac/index.js'
import { RoleCache } from './rbac/roleCache.js'
import type { Role } from './rbac/roleCache.js'
import { checkAccess } from './gateway/rbac.js'
import { searchAll } from './router/index.js'
import { ToolRegistry } from './gateway/registry.js'
import type { BackendClient } from './gateway/registry.js'
import type { ServerDeps } from './gateway/server.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeTextResult = (text: string): CallToolResult => ({
  content: [{ type: 'text', text }],
  isError: false,
})

const makeTool = (name: string): Tool => ({
  name,
  description: `Tool ${name}`,
  inputSchema: { type: 'object', properties: {} },
})

const resultText = (result: CallToolResult): string =>
  (result.content[0] as { type: string; text: string }).text

/**
 * Build a fully wired ServerDeps using real module implementations.
 * Returns both the deps object AND the ToolRegistry so tests can call initialize().
 */
const buildDeps = (overrides: {
  userEmail?: string
  exec?: (cmd: string, args: string[]) => Promise<string>
  fetchRole?: (email: string) => Promise<Role>
  classify?: (query: string) => Promise<string[]>
  callBackendSearch?: (backend: string, query: string) => Promise<CallToolResult>
  backendClients?: Record<string, BackendClient>
  cache?: RoleCache
}): { deps: ServerDeps; registry: ToolRegistry } => {
  const cache = overrides.cache ?? new RoleCache()
  const fetchRole: (email: string) => Promise<Role> =
    overrides.fetchRole ?? (() => Promise.reject(new Error('fetchRole not configured')))
  const getUserRole = makeGetUserRole({ fetchRole, cache })

  const classifyFn = overrides.classify ?? (() => Promise.resolve([]))
  const callBackendSearch =
    overrides.callBackendSearch ??
    ((_backend: string, _query: string) => Promise.resolve(makeTextResult('')))

  const backendClients = overrides.backendClients ?? {}
  const registry = new ToolRegistry({ backends: backendClients })

  const email = overrides.userEmail ?? 'test@company.com'
  const execFn = overrides.exec ?? ((_cmd: string, _args: string[]) => Promise.reject(new Error('exec not configured')))

  const deps: ServerDeps = {
    registry,
    detectIdentity: () =>
      detectIdentity({
        exec: async (cmd, args) => {
          if (cmd === 'git' && args[0] === 'config') return email
          return execFn(cmd, args)
        },
      }),
    getUserRole,
    checkAccess,
    searchAll: (query: string) => searchAll(query, { classify: classifyFn, callBackendSearch }),
  }

  return { deps, registry }
}

// ─── Dev role scenarios ───────────────────────────────────────────────────────

describe('dev role — search_all routing', () => {
  it('routes "top crashes?" to firebase and returns firebase result', async () => {
    const { deps } = buildDeps({
      userEmail: 'dev@company.com',
      fetchRole: async () => 'dev',
      classify: async () => ['firebase', 'atlassian', 'teams'],
      callBackendSearch: async (backend) =>
        backend === 'firebase'
          ? makeTextResult('NullPointerException: 142 events in last 24h')
          : makeTextResult(''),
    })

    const result = await handleCallTool('search_all', { query: 'top crashes?' }, deps)

    expect(result.isError).toBe(false)
    expect(resultText(result)).toContain('NullPointerException')
  })

  it('routes "my sprint tasks" to atlassian and returns atlassian result', async () => {
    const { deps } = buildDeps({
      userEmail: 'dev@company.com',
      fetchRole: async () => 'dev',
      classify: async () => ['atlassian', 'firebase', 'teams'],
      callBackendSearch: async (backend) =>
        backend === 'atlassian'
          ? makeTextResult('3 open issues in current sprint')
          : makeTextResult(''),
    })

    const result = await handleCallTool('search_all', { query: 'my sprint tasks' }, deps)

    expect(result.isError).toBe(false)
    expect(resultText(result)).toContain('3 open issues')
  })

  it('blocks atlassian_create_issue with "Access denied" message', async () => {
    const callTool = vi.fn().mockResolvedValue(makeTextResult('should not be called'))
    const atlassianClient: BackendClient = {
      listTools: async () => [makeTool('create_issue')],
      callTool,
    }
    const { deps, registry } = buildDeps({
      userEmail: 'dev@company.com',
      fetchRole: async () => 'dev',
      backendClients: { atlassian: atlassianClient },
    })
    await registry.initialize()

    const result = await handleCallTool('atlassian_create_issue', { summary: 'Bug' }, deps)

    expect(result.isError).toBe(true)
    expect(resultText(result)).toContain('Access denied')
    expect(callTool).not.toHaveBeenCalled()
  })
})

// ─── Lead role scenarios ──────────────────────────────────────────────────────

describe('lead role — write operations succeed', () => {
  it('atlassian_create_issue succeeds for a lead user', async () => {
    const atlassianClient: BackendClient = {
      listTools: async () => [makeTool('create_issue')],
      callTool: async () => makeTextResult('Issue PROJ-123 created'),
    }
    const { deps, registry } = buildDeps({
      userEmail: 'lead@company.com',
      fetchRole: async () => 'lead',
      backendClients: { atlassian: atlassianClient },
    })
    await registry.initialize()

    const result = await handleCallTool('atlassian_create_issue', { summary: 'New feature' }, deps)

    expect(result.isError).toBe(false)
    expect(resultText(result)).toContain('PROJ-123')
  })

  it('teams_send_message succeeds for a lead user', async () => {
    const teamsClient: BackendClient = {
      listTools: async () => [makeTool('send_message')],
      callTool: async () => makeTextResult('Message sent to #general'),
    }
    const { deps, registry } = buildDeps({
      userEmail: 'lead@company.com',
      fetchRole: async () => 'lead',
      backendClients: { teams: teamsClient },
    })
    await registry.initialize()

    const result = await handleCallTool('teams_send_message', { body: 'Hello team' }, deps)

    expect(result.isError).toBe(false)
    expect(resultText(result)).toContain('Message sent')
  })
})

// ─── Identity detection chain ─────────────────────────────────────────────────

describe('identity detection', () => {
  it('uses email from git config when present', async () => {
    const identity = await detectIdentity({
      exec: async (cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'config') return 'git@company.com'
        return ''
      },
    })
    expect(identity.email).toBe('git@company.com')
  })

  it('falls through to gh CLI when git email is empty', async () => {
    const identity = await detectIdentity({
      exec: async (cmd: string) => {
        if (cmd === 'git') return ''
        if (cmd === 'gh') return '"gh@company.com"'
        return ''
      },
    })
    expect(identity.email).toBe('gh@company.com')
  })

  it('throws a clear error when all identity sources fail', async () => {
    await expect(
      detectIdentity({
        exec: async () => { throw new Error('not installed') },
      }),
    ).rejects.toThrow('Identity not found. Set GATEWAY_USER_EMAIL or configure git user.email.')
  })
})

// ─── RBAC cache behaviour ─────────────────────────────────────────────────────

describe('RBAC cache', () => {
  it('serves role from cache on second call without hitting fetchRole again', async () => {
    let callCount = 0
    const fetchRole = async (_email: string): Promise<Role> => {
      callCount++
      return 'dev'
    }
    const getUserRole = makeGetUserRole({ fetchRole, cache: new RoleCache(60_000) })

    await getUserRole('dev@company.com')
    await getUserRole('dev@company.com')

    expect(callCount).toBe(1)
  })

  it('re-fetches role after TTL expires', async () => {
    let callCount = 0
    const roles: Role[] = ['dev', 'lead']
    const fetchRole = async (_email: string): Promise<Role> => {
      return roles[callCount++]!
    }
    // TTL = -1ms: condition is Date.now() - fetchedAt > -1, always true → always stale
    const getUserRole = makeGetUserRole({ fetchRole, cache: new RoleCache(-1) })

    const first = await getUserRole('dev@company.com')
    const second = await getUserRole('dev@company.com')

    expect(callCount).toBe(2)
    expect(first).toBe('dev')
    expect(second).toBe('lead')
  })
})

// ─── Backend error propagation ────────────────────────────────────────────────

describe('backend error propagation', () => {
  it('returns a clean error result (no stack trace) when backend throws a 401', async () => {
    const atlassianClient: BackendClient = {
      listTools: async () => [makeTool('search_issues')],
      callTool: async () => {
        throw new Error('Token expired — re-authenticate and try again')
      },
    }
    const { deps, registry } = buildDeps({
      userEmail: 'dev@company.com',
      fetchRole: async () => 'dev',
      backendClients: { atlassian: atlassianClient },
    })
    await registry.initialize()

    const result = await handleCallTool('atlassian_search_issues', {}, deps)

    expect(result.isError).toBe(true)
    const text = resultText(result)
    expect(text).toContain('Token expired — re-authenticate')
    expect(text).not.toContain('    at ') // no stack frames in the message
  })
})
