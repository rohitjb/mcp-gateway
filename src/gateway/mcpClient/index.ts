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
