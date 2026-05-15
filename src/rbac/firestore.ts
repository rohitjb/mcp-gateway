import { readFile } from 'node:fs/promises'
import type { Role } from './roleCache.js'

export interface StdioBackendConfig {
  readonly command: string
  readonly args?: string[]
  readonly env?: Record<string, string>
}

export interface HttpBackendConfig {
  readonly url: string
  readonly headers?: Record<string, string>
  readonly clientId?: string
  // Override the OAuth scope the SDK requests. Set to "" to omit scope entirely.
  readonly scope?: string
}

// Spawns a local HTTP server process then connects to it via HTTP transport.
// Use when a backend only supports HTTP (not stdio) but should start with the gateway.
export interface LocalHttpBackendConfig {
  readonly command: string
  readonly args?: string[]
  readonly env?: Record<string, string>
  readonly url: string
  readonly transport?: 'sse' | 'http'
}

export type BackendConfig = StdioBackendConfig | HttpBackendConfig | LocalHttpBackendConfig

export interface FirestoreConfig {
  readonly projectId: string
}

export interface GatewayConfig {
  readonly firebase: FirestoreConfig
  readonly backends: Record<string, BackendConfig>
  readonly router?: {
    readonly model?: string
  }
}

export const loadGatewayConfig = async (configPath: string): Promise<GatewayConfig> => {
  const raw = await readFile(configPath, 'utf8')
  return JSON.parse(raw) as GatewayConfig
}

const isCredentialError = (error: unknown): boolean => {
  const msg = error instanceof Error ? error.message : String(error)
  return (
    msg.includes('Could not load the default credentials') ||
    msg.includes('GOOGLE_APPLICATION_CREDENTIALS') ||
    msg.includes('invalid_grant') ||
    msg.includes('Application Default Credentials')
  )
}

// Initializes Firebase Admin with Application Default Credentials at server startup.
// If credentials are missing, fails with clear instructions — run `pnpm exec tsx src/index.ts login` once in a terminal.
export const initFirestore = async (config: FirestoreConfig): Promise<void> => {
  const { default: admin } = await import('firebase-admin')

  if (admin.apps.length) return

  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: config.projectId,
  })

  try {
    await admin.firestore().collection('rbac').doc('config').get()
    process.stderr.write(`[firebase] connected to project "${config.projectId}"\n`)
  } catch (error) {
    await admin.app().delete()
    const detail = error instanceof Error ? error.message : String(error)
    if (isCredentialError(error)) {
      throw new Error(
        `[firebase] No credentials found for project "${config.projectId}".\n` +
        `Run this once in your terminal to authenticate:\n\n` +
        `  pnpm gateway:login\n\n` +
        `Then restart the MCP server.`,
      )
    }
    throw new Error(
      `[firebase] Cannot access project "${config.projectId}": ${detail}`,
    )
  }
}

export const makeFetchRoleFromFirestore = (_config: FirestoreConfig) => async (email: string): Promise<Role> => {
  const { default: admin } = await import('firebase-admin')
  const db = admin.firestore()
  const doc = await db.collection('rbac').doc('config').get()

  if (!doc.exists) {
    throw new Error('RBAC config not found in Firestore (rbac/config)')
  }

  const data = doc.data() as { dev?: string[]; leads?: string[] } | undefined

  if (data?.dev?.includes(email)) return 'dev'
  if (data?.leads?.includes(email)) return 'lead'

  throw new Error(`User not found: ${email}`)
}
