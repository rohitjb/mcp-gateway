import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { Identity } from '../types.js'
import type { Role } from '../rbac/roleCache.js'

const SEARCH_ALL_TOOL: Tool = {
  name: 'search_all',
  description:
    'Search across all connected services (Atlassian, Firebase, Teams, GitHub, Figma) using a natural language query. The gateway automatically routes to the most relevant backend.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Natural language search query' },
    },
    required: ['query'],
  },
}

export interface RegistryHandle {
  getTools: () => Tool[]
  callTool: (name: string, args: Record<string, unknown>) => Promise<CallToolResult>
}

export interface ServerDeps {
  registry: RegistryHandle
  detectIdentity: () => Promise<Identity>
  getUserRole: (email: string) => Promise<Role>
  checkAccess: (toolName: string, role: Role) => void
  searchAll: (query: string) => Promise<CallToolResult>
  // Resolves once all configured backends have finished their initial connect
  // attempt (or a sane timeout has elapsed). Gating the first tools/list on
  // this guarantees the MCP client sees the full proxied tool set on the
  // initial snapshot instead of just search_all.
  backendsReady?: Promise<void>
}

export const handleListTools = async (deps: ServerDeps): Promise<{ tools: Tool[] }> => {
  if (deps.backendsReady) await deps.backendsReady
  return { tools: [SEARCH_ALL_TOOL, ...deps.registry.getTools()] }
}

export const handleCallTool = async (
  toolName: string,
  args: Record<string, unknown>,
  deps: ServerDeps,
): Promise<CallToolResult> => {
  // search_all bypasses RBAC (it is always read-only) and routes via the classifier
  if (toolName === 'search_all') {
    const query = args['query']
    if (typeof query !== 'string' || !query.trim()) {
      return {
        content: [{ type: 'text', text: 'search_all requires a non-empty "query" argument.' }],
        isError: true,
      }
    }
    return deps.searchAll(query)
  }

  try {
    const identity = await deps.detectIdentity()
    const role = await deps.getUserRole(identity.email)
    process.stderr.write(`[rbac] tool=${toolName} email=${identity.email} role=${role}\n`)
    deps.checkAccess(toolName, role)
    return await deps.registry.callTool(toolName, args)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    process.stderr.write(`[rbac] blocked: ${message}\n`)
    return { content: [{ type: 'text', text: message }], isError: true }
  }
}

export const createGatewayServer = (deps: ServerDeps): Server => {
  const server = new Server(
    { name: 'mcp-gateway', version: '0.1.0' },
    { capabilities: { tools: { listChanged: true } } },
  )

  server.setRequestHandler(ListToolsRequestSchema, () => handleListTools(deps))

  server.setRequestHandler(CallToolRequestSchema, req =>
    handleCallTool(
      req.params.name,
      (req.params.arguments ?? {}) as Record<string, unknown>,
      deps,
    ),
  )

  return server
}

export const startGatewayServer = async (deps: ServerDeps): Promise<Server> => {
  const server = createGatewayServer(deps)
  const transport = new StdioServerTransport()
  await server.connect(transport)
  return server
}
