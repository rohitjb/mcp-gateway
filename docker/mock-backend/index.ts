// A tiny stdio MCP server used by the docker compose quickstart.
//
// Exposes two tools so a fresh evaluator can see RBAC actually doing something:
//   - demo_search   → read (passes for any role)
//   - demo_create   → write (blocked for `dev` role by the gateway's verb regex)
//
// Returns canned JSON. No state, no external calls.

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js'

// Tool names are unprefixed — the gateway adds the `demo_` prefix (the backend
// key in gateway.config.docker.json) when it exposes them upstream. So these
// become `demo_search` and `demo_create` to the AI client. `demo_create`
// matches the gateway's write-verb regex; `demo_search` does not.
const TOOLS: Tool[] = [
  {
    name: 'search',
    description: 'Search the demo dataset for items matching a query string.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Search query' } },
      required: ['query'],
    },
  },
  {
    name: 'create',
    description: 'Create a new item in the demo dataset.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Name of the item to create' } },
      required: ['name'],
    },
  },
]

const handleSearch = (args: Record<string, unknown>): CallToolResult => {
  const query = typeof args['query'] === 'string' ? args['query'] : ''
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        results: [
          { id: 1, title: `Mock result for: ${query}` },
          { id: 2, title: `Another mock result for: ${query}` },
        ],
      }),
    }],
  }
}

const handleCreate = (args: Record<string, unknown>): CallToolResult => {
  const name = typeof args['name'] === 'string' ? args['name'] : 'unnamed'
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ created: { id: 42, name } }),
    }],
  }
}

const server = new Server(
  { name: 'mock-backend', version: '0.1.0' },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: TOOLS }))

server.setRequestHandler(CallToolRequestSchema, req => {
  const name = req.params.name
  const args = (req.params.arguments ?? {}) as Record<string, unknown>
  if (name === 'search') return handleSearch(args)
  if (name === 'create') return handleCreate(args)
  return {
    content: [{ type: 'text', text: `Unknown tool: ${name}` }],
    isError: true,
  }
})

const transport = new StdioServerTransport()
await server.connect(transport)
process.stderr.write('[mock-backend] ready on stdio\n')
