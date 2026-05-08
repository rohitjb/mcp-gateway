import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js'

export interface BackendClient {
  listTools: () => Promise<Tool[]>
  callTool: (name: string, args: Record<string, unknown>) => Promise<CallToolResult>
}

export interface RegistryDeps {
  backends: Record<string, BackendClient>
}

interface ToolEntry {
  tool: Tool
  backend: string
  originalName: string
}

export class ToolRegistry {
  private entries: ToolEntry[] = []

  constructor(private readonly deps: RegistryDeps) {}

  async initialize(): Promise<void> {
    this.entries = []
    for (const [backend, client] of Object.entries(this.deps.backends)) {
      const tools = await client.listTools()
      for (const tool of tools) {
        this.entries.push({
          tool: { ...tool, name: `${backend}_${tool.name}` },
          backend,
          originalName: tool.name,
        })
      }
    }
  }

  getTools(): Tool[] {
    return this.entries.map(e => e.tool)
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    const entry = this.entries.find(e => e.tool.name === name)
    if (!entry) throw new Error(`Unknown tool: ${name}`)
    return this.deps.backends[entry.backend]!.callTool(entry.originalName, args)
  }
}
