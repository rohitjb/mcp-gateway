import { Command } from 'commander'
import { detectIdentity } from './identity/detect.js'
import { execFile } from './utils/exec.js'
import { makeGetUserRole } from './rbac/index.js'
import { RoleCache } from './rbac/roleCache.js'
import { loadGatewayConfig, initFirestore, makeFetchRoleFromFirestore } from './rbac/firestore.js'
import { runGoogleLogin } from './login/index.js'
import { checkAccess } from './gateway/rbac.js'
import { ToolRegistry } from './gateway/registry.js'
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

      await initFirestore(config.firebase)

      const cache = new RoleCache()
      const fetchRole = makeFetchRoleFromFirestore(config.firebase)
      const getUserRole = makeGetUserRole({ fetchRole, cache })

      const registry = new ToolRegistry()

      const classifyFn = (query: string) => Promise.resolve(classify(query))

      const callBackendSearch = (backend: string, query: string) =>
        registry.callTool(`${backend}_search_issues`, { query }).catch(() =>
          registry.callTool(`${backend}_search`, { query }),
        )

      // Start the MCP transport immediately so the client gets an initialize response
      // without waiting for backend connections (which can take 10–30 s with OAuth).
      await startGatewayServer({
        registry,
        detectIdentity: () => detectIdentity({ exec: execFile }),
        getUserRole,
        checkAccess,
        searchAll: query => searchAll(query, { classify: classifyFn, callBackendSearch }),
      })

      if (!config.backends || typeof config.backends !== 'object') {
        process.stderr.write('[gateway] warning: gateway.config.json is missing "backends" — see gateway.config.example.json\n')
        return
      }

      // Connect each backend in the background; tools become available as each one comes online.
      for (const [name, backendConfig] of Object.entries(config.backends)) {
        connectMcpClient(backendConfig, name)
          .then(client => registry.addBackend(name, client))
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err)
            process.stderr.write(`[gateway] backend "${name}" failed to connect: ${msg}\n`)
          })
      }
    })

  program
    .command('login')
    .description('Authenticate with Google (ADC) so the gateway can connect to Firebase')
    .action(async () => {
      await runGoogleLogin()
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
