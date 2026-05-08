import { Command } from 'commander'
import { detectIdentity } from './identity/detect.js'
import { execFile } from './utils/exec.js'
import { makeGetUserRole } from './rbac/index.js'
import { RoleCache } from './rbac/roleCache.js'
import { loadGatewayConfig, makeFetchRoleFromFirestore } from './rbac/firestore.js'
import { checkAccess } from './gateway/rbac.js'
import { ToolRegistry } from './gateway/registry.js'
import type { BackendClient } from './gateway/registry.js'
import { connectMcpClient } from './gateway/mcpClient/index.js'
import { searchAll } from './router/index.js'
import { classify } from './router/classify.js'
import { startGatewayServer } from './gateway/server.js'
import { resolve } from 'node:path'

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
