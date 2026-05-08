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
