import { describe, it, expect, vi } from 'vitest'
import type { ServerDeps } from './server.js'
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { AccessDeniedError } from './rbac.js'

const makeTool = (name: string): Tool => ({
  name,
  description: `Tool ${name}`,
  inputSchema: { type: 'object', properties: {} },
})

const makeResult = (text: string): CallToolResult => ({
  content: [{ type: 'text', text }],
  isError: false,
})

const baseDeps = (): ServerDeps => ({
  registry: {
    getTools: vi.fn().mockReturnValue([
      makeTool('atlassian_search_issues'),
      makeTool('atlassian_create_issue'),
      makeTool('firebase_get_crashes'),
    ]),
    callTool: vi.fn().mockResolvedValue(makeResult('ok')),
  },
  detectIdentity: vi.fn().mockResolvedValue({ email: 'dev@example.com' }),
  getUserRole: vi.fn().mockResolvedValue('dev'),
  checkAccess: vi.fn(),
  searchAll: vi.fn().mockResolvedValue(makeResult('search results')),
})

describe('handleListTools', () => {
  it('returns all registry tools plus the search_all tool', async () => {
    const { handleListTools } = await import('./server.js')
    const deps = baseDeps()
    const result = await handleListTools(deps)
    const names = result.tools.map(t => t.name)
    expect(names).toContain('atlassian_search_issues')
    expect(names).toContain('search_all')
    expect(result.tools).toHaveLength(4) // 3 registry + search_all
  })

  it('awaits backendsReady before snapshotting the registry tools', async () => {
    const { handleListTools } = await import('./server.js')
    const registryTools: Tool[] = []
    const getTools = vi.fn().mockImplementation(() => [...registryTools])
    let resolveReady!: () => void
    const backendsReady = new Promise<void>(r => { resolveReady = r })

    const deps: ServerDeps = {
      ...baseDeps(),
      registry: { getTools, callTool: vi.fn().mockResolvedValue(makeResult('ok')) },
      backendsReady,
    }

    const pending = handleListTools(deps)

    // backends not yet registered — push a tool to simulate late registration
    registryTools.push(makeTool('atlassian_search_issues'))
    resolveReady()

    const result = await pending
    const names = result.tools.map(t => t.name)
    expect(names).toContain('atlassian_search_issues')
    expect(names).toContain('search_all')
  })

  it('returns immediately when backendsReady is omitted (backward compatible)', async () => {
    const { handleListTools } = await import('./server.js')
    const deps = baseDeps()
    const result = await handleListTools(deps)
    expect(result.tools.length).toBeGreaterThan(0)
  })
})

describe('handleCallTool — search_all routing', () => {
  it('delegates to searchAll when tool name is "search_all"', async () => {
    const { handleCallTool } = await import('./server.js')
    const deps = baseDeps()

    const result = await handleCallTool('search_all', { query: 'top crashes' }, deps)

    expect(deps.searchAll).toHaveBeenCalledWith('top crashes')
    expect(deps.registry.callTool).not.toHaveBeenCalled()
    expect((result.content[0] as { type: string; text: string }).text).toBe('search results')
  })

  it('returns an error result when search_all is called without a query argument', async () => {
    const { handleCallTool } = await import('./server.js')
    const deps = baseDeps()

    const result = await handleCallTool('search_all', {}, deps)

    expect(result.isError).toBe(true)
    expect((result.content[0] as { type: string; text: string }).text).toContain('query')
  })
})

describe('handleCallTool', () => {
  it('detects identity, fetches role, checks access, then calls the tool', async () => {
    const { handleCallTool } = await import('./server.js')
    const deps = baseDeps()
    const result = await handleCallTool('atlassian_search_issues', { query: 'bug' }, deps)

    expect(deps.detectIdentity).toHaveBeenCalledOnce()
    expect(deps.getUserRole).toHaveBeenCalledWith('dev@example.com')
    expect(deps.checkAccess).toHaveBeenCalledWith('atlassian_search_issues', 'dev')
    expect(deps.registry.callTool).toHaveBeenCalledWith('atlassian_search_issues', { query: 'bug' })
    expect(result).toEqual(makeResult('ok'))
  })

  it('returns an error result when checkAccess throws AccessDeniedError', async () => {
    const { handleCallTool } = await import('./server.js')
    const deps = baseDeps()
    vi.mocked(deps.getUserRole).mockResolvedValue('dev')
    vi.mocked(deps.checkAccess).mockImplementation(() => {
      throw new AccessDeniedError('atlassian_create_issue')
    })

    const result = await handleCallTool('atlassian_create_issue', {}, deps)

    expect(result.isError).toBe(true)
    expect((result.content[0] as { type: string; text: string }).text).toContain('Access denied')
    expect(deps.registry.callTool).not.toHaveBeenCalled()
  })

  it('returns an error result when identity detection fails', async () => {
    const { handleCallTool } = await import('./server.js')
    const deps = baseDeps()
    vi.mocked(deps.detectIdentity).mockRejectedValue(
      new Error("Identity not found. Run 'npx mcp-gateway auth' to complete setup."),
    )

    const result = await handleCallTool('atlassian_search_issues', {}, deps)

    expect(result.isError).toBe(true)
    expect((result.content[0] as { type: string; text: string }).text).toContain('Identity not found')
    expect(deps.registry.callTool).not.toHaveBeenCalled()
  })

  it('returns an error result when the backend tool call fails', async () => {
    const { handleCallTool } = await import('./server.js')
    const deps = baseDeps()
    vi.mocked(deps.registry.callTool).mockRejectedValue(new Error('Backend unavailable'))

    const result = await handleCallTool('firebase_get_crashes', {}, deps)

    expect(result.isError).toBe(true)
    expect((result.content[0] as { type: string; text: string }).text).toContain('Backend unavailable')
  })
})
