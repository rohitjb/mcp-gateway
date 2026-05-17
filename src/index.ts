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

      // Backends connect in the background, but the first tools/list response
      // must include their tools — otherwise the MCP client only ever sees
      // search_all (clients don't always re-snapshot on list_changed).
      // We expose a "backendsReady" promise that handleListTools awaits, and
      // resolve it as soon as the initial connect round finishes — or after
      // BACKENDS_READY_TIMEOUT_MS, whichever comes first, so a slow OAuth
      // flow doesn't block startup forever.
      const BACKENDS_READY_TIMEOUT_MS = 25_000
      let resolveBackendsReady: () => void = () => {}
      const backendsReadyDeferred = new Promise<void>(r => { resolveBackendsReady = r })
      const backendsReady = Promise.race([
        backendsReadyDeferred,
        new Promise<void>(r => setTimeout(r, BACKENDS_READY_TIMEOUT_MS)),
      ])

      // Start the MCP transport immediately so the client gets an initialize response
      // without waiting for backend connections (which can take 10–30 s with OAuth).
      const server = await startGatewayServer({
        registry,
        detectIdentity: () => detectIdentity({ exec: execFile }),
        getUserRole,
        checkAccess,
        searchAll: query => searchAll(query, { classify: classifyFn, callBackendSearch }),
        backendsReady,
      })

      if (!config.backends || typeof config.backends !== 'object') {
        process.stderr.write('[gateway] warning: gateway.config.json is missing "backends" — see gateway.config.example.json\n')
        resolveBackendsReady()
        return
      }

      // Connect each backend in the background; tools become available as each one comes online.
      // After each backend registers its tools, notify the client so it re-fetches the tool list
      // (used both for late arrivals past the timeout and for clients that honor list_changed).
      const backendPromises = Object.entries(config.backends).map(([name, backendConfig]) =>
        connectMcpClient(backendConfig, name)
          .then(async client => {
            await registry.addBackend(name, client)
            await server.sendToolListChanged().catch((err: unknown) => {
              const msg = err instanceof Error ? err.message : String(err)
              process.stderr.write(`[gateway] failed to send tools/list_changed: ${msg}\n`)
            })
          })
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err)
            process.stderr.write(`[gateway] backend "${name}" failed to connect: ${msg}\n`)
          }),
      )

      void Promise.allSettled(backendPromises).then(() => {
        process.stderr.write(`[gateway] all backends settled — releasing tools/list\n`)
        resolveBackendsReady()
      })
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
