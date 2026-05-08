import { describe, it, expect, vi } from 'vitest'
import type { BackendClient, RegistryDeps } from './registry.js'
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js'

const makeTool = (name: string): Tool => ({
  name,
  description: `Tool ${name}`,
  inputSchema: { type: 'object', properties: {} },
})

const makeBackend = (tools: Tool[]): BackendClient => ({
  listTools: vi.fn().mockResolvedValue(tools),
  callTool: vi.fn().mockResolvedValue({
    content: [{ type: 'text', text: 'result' }],
    isError: false,
  } satisfies CallToolResult),
})

describe('ToolRegistry', () => {
  const makeDeps = (): RegistryDeps => ({
    backends: {
      atlassian: makeBackend([makeTool('search_issues'), makeTool('create_issue')]),
      firebase: makeBackend([makeTool('get_crashes')]),
      teams: makeBackend([makeTool('list_channels'), makeTool('send_message')]),
    },
  })

  it('getTools() returns all backend tools with namespace prefix after initialize()', async () => {
    const { ToolRegistry } = await import('./registry.js')
    const registry = new ToolRegistry(makeDeps())
    await registry.initialize()
    const names = registry.getTools().map(t => t.name)
    expect(names).toContain('atlassian_search_issues')
    expect(names).toContain('atlassian_create_issue')
    expect(names).toContain('firebase_get_crashes')
    expect(names).toContain('teams_list_channels')
    expect(names).toContain('teams_send_message')
  })

  it('getTools() returns empty array before initialize()', async () => {
    const { ToolRegistry } = await import('./registry.js')
    const registry = new ToolRegistry(makeDeps())
    expect(registry.getTools()).toEqual([])
  })

  it('callTool() strips the namespace prefix and forwards to the correct backend', async () => {
    const { ToolRegistry } = await import('./registry.js')
    const deps = makeDeps()
    const registry = new ToolRegistry(deps)
    await registry.initialize()

    await registry.callTool('atlassian_search_issues', { query: 'bug' })

    expect(deps.backends['atlassian']!.callTool).toHaveBeenCalledWith('search_issues', { query: 'bug' })
    expect(deps.backends['firebase']!.callTool).not.toHaveBeenCalled()
  })

  it('callTool() routes firebase tools to the firebase backend', async () => {
    const { ToolRegistry } = await import('./registry.js')
    const deps = makeDeps()
    const registry = new ToolRegistry(deps)
    await registry.initialize()

    await registry.callTool('firebase_get_crashes', {})

    expect(deps.backends['firebase']!.callTool).toHaveBeenCalledWith('get_crashes', {})
  })

  it('callTool() throws for an unregistered tool name', async () => {
    const { ToolRegistry } = await import('./registry.js')
    const registry = new ToolRegistry(makeDeps())
    await registry.initialize()

    await expect(registry.callTool('unknown_tool', {})).rejects.toThrow('Unknown tool: unknown_tool')
  })

  it('tool descriptions include the original backend description', async () => {
    const { ToolRegistry } = await import('./registry.js')
    const deps: RegistryDeps = {
      backends: {
        atlassian: makeBackend([{ name: 'search_issues', description: 'Search Jira issues', inputSchema: { type: 'object', properties: {} } }]),
        firebase: makeBackend([]),
        teams: makeBackend([]),
      },
    }
    const registry = new ToolRegistry(deps)
    await registry.initialize()
    const tool = registry.getTools().find(t => t.name === 'atlassian_search_issues')
    expect(tool?.description).toBe('Search Jira issues')
  })
})
