import { spawn } from 'node:child_process'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BackendClient } from '../registry.js'
import type { BackendConfig, HttpBackendConfig, LocalHttpBackendConfig } from '../../rbac/firestore.js'
import { GatewayOAuthProvider } from '../oauthProvider/index.js'

const SPAWN_RETRY_ATTEMPTS = 10
const SPAWN_RETRY_DELAY_MS = 500

interface SdkClient {
  connect(transport: unknown): Promise<void>
  listTools(): Promise<{ tools: Tool[] }>
  callTool(params: { name: string; arguments: Record<string, unknown> }): Promise<CallToolResult>
}

interface McpClientDeps {
  makeClient: () => SdkClient
  makeTransport: (config: BackendConfig, authProvider?: OAuthClientProvider) => unknown
}

const isHttpConfig = (c: BackendConfig): c is HttpBackendConfig =>
  'url' in c && !('command' in c)

const isLocalHttpConfig = (c: BackendConfig): c is LocalHttpBackendConfig =>
  'url' in c && 'command' in c

const makeEnv = (extra?: Record<string, string>): Record<string, string> | undefined =>
  extra
    ? (Object.fromEntries(
        Object.entries({ ...process.env, ...extra }).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      ) as Record<string, string>)
    : undefined

const waitForHttp = async (url: string): Promise<void> => {
  for (let i = 0; i < SPAWN_RETRY_ATTEMPTS; i++) {
    try {
      const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(1_000) })
      process.stderr.write(`[gateway] local HTTP backend ready at ${url} (status ${res.status})\n`)
      return
    } catch (err) {
      process.stderr.write(`[gateway] waiting for local HTTP backend at ${url} (attempt ${i + 1}/${SPAWN_RETRY_ATTEMPTS})\n`)
      await new Promise(r => setTimeout(r, SPAWN_RETRY_DELAY_MS))
    }
  }
  process.stderr.write(`[gateway] local HTTP backend at ${url} did not become ready\n`)
}

const killPortIfInUse = (port: number): void => {
  try {
    const result = spawn('lsof', ['-ti', `:${port}`], { stdio: ['ignore', 'pipe', 'ignore'] })
    let pids = ''
    result.stdout?.on('data', (d: Buffer) => { pids += d.toString() })
    result.on('close', () => {
      pids.trim().split('\n').filter(Boolean).forEach(pid => {
        try { process.kill(Number(pid), 'SIGKILL') } catch { /* already gone */ }
      })
    })
  } catch { /* lsof not available */ }
}

const isPortHealthy = async (url: string): Promise<boolean> => {
  try {
    await fetch(url, { method: 'GET', signal: AbortSignal.timeout(500) })
    return true
  } catch {
    return false
  }
}

const spawnLocalHttpBackend = async (config: LocalHttpBackendConfig): Promise<void> => {
  const { origin, port } = new URL(config.url)

  // If the backend is already running and healthy, reuse it instead of killing and restarting.
  if (await isPortHealthy(origin)) {
    process.stderr.write(`[gateway] local HTTP backend already running at ${origin}, reusing\n`)
    return
  }

  if (port) killPortIfInUse(Number(port))

  const env = makeEnv(config.env)
  const child = spawn(config.command, config.args ?? [], {
    env: env ?? (process.env as Record<string, string>),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  })
  child.stdout?.on('data', (d: Buffer) => process.stderr.write(`[local-http] ${d}`))
  child.stderr?.on('data', (d: Buffer) => process.stderr.write(`[local-http] ${d}`))
  child.on('error', (err) => process.stderr.write(`[gateway] local HTTP backend process error: ${err.message}\n`))
  child.on('exit', (code) => process.stderr.write(`[gateway] local HTTP backend exited with code ${String(code)}\n`))
}

const productionDeps = (_config: BackendConfig): McpClientDeps => ({
  makeClient: () => new Client({ name: 'mcp-gateway', version: '0.1.0' }) as SdkClient,
  makeTransport: (c, authProvider) => {
    if (isHttpConfig(c)) {
      return new StreamableHTTPClientTransport(
        new URL(c.url),
        {
          ...(c.headers ? { requestInit: { headers: c.headers } } : {}),
          ...(authProvider ? { authProvider } : {}),
        },
      )
    }
    if (isLocalHttpConfig(c)) {
      return (c.transport === 'http')
        ? new StreamableHTTPClientTransport(new URL(c.url), {})
        : new SSEClientTransport(new URL(c.url))
    }
    const env = makeEnv(c.env)
    return env
      ? new StdioClientTransport({ command: c.command, args: c.args ?? [], env })
      : new StdioClientTransport({ command: c.command, args: c.args ?? [] })
  },
})

const makeBackendClient = (client: SdkClient): BackendClient => ({
  listTools: async () => {
    const { tools } = await client.listTools()
    return tools
  },
  callTool: (name, args) => client.callTool({ name, arguments: args }),
})

export const connectMcpClient = async (
  config: BackendConfig,
  serverName?: string,
  deps: McpClientDeps = productionDeps(config),
): Promise<BackendClient> => {
  if (isLocalHttpConfig(config)) {
    await spawnLocalHttpBackend(config)
    const { origin } = new URL(config.url)
    await waitForHttp(origin)
  }

  const hasStaticAuth = isHttpConfig(config) &&
    Boolean(config.headers?.['Authorization'] ?? config.headers?.['X-Figma-Token'])

  const oauthProvider = isHttpConfig(config) && serverName && !hasStaticAuth
    ? new GatewayOAuthProvider(serverName, config.url, config.clientId, config.scope)
    : undefined

  const client = deps.makeClient()
  const transport = deps.makeTransport(config, oauthProvider)

  try {
    await client.connect(transport)
    return makeBackendClient(client)
  } catch (err) {
    if (err instanceof UnauthorizedError && oauthProvider) {
      // OAuth browser flow completed inside GatewayOAuthProvider.redirectToAuthorization.
      // Tokens are now saved — retry with a fresh client+transport to use them.
      const retryClient = deps.makeClient()
      const retryTransport = deps.makeTransport(config, oauthProvider)
      await retryClient.connect(retryTransport)
      return makeBackendClient(retryClient)
    }
    throw err
  }
}
