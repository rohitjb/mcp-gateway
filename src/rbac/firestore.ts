import { readFile } from 'node:fs/promises'
import type { Role } from './roleCache.js'

export interface BackendConfig {
  readonly command: string
  readonly args?: string[]
  readonly env?: Record<string, string>
}

export interface FirestoreConfig {
  readonly projectId: string
  readonly credentialsPath: string
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

export const makeFetchRoleFromFirestore = (config: FirestoreConfig) => async (email: string): Promise<Role> => {
  // Lazy-import firebase-admin so tests that don't touch Firestore don't pay init cost
  const { default: admin } = await import('firebase-admin')

  if (!admin.apps.length) {
    const { default: serviceAccount } = await import(config.credentialsPath, {
      with: { type: 'json' },
    })
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount as object),
      projectId: config.projectId,
    })
  }

  const db = admin.firestore()
  const doc = await db.collection('users').doc(email).get()

  if (!doc.exists) {
    throw new Error(`User not found: ${email}`)
  }

  const data = doc.data() as { role?: string } | undefined
  const role = data?.role

  if (role !== 'dev' && role !== 'lead') {
    throw new Error(`Invalid role "${role ?? 'undefined'}" for user: ${email}`)
  }

  return role
}
