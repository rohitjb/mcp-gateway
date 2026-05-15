import type { Role } from '../rbac/roleCache.js'

// Any tool whose name contains one of these verbs (after the backend_ prefix) is a write operation.
// This covers all backends automatically — no need to hardcode per-service tool names.
const WRITE_VERB_RE =
  /_(create|update|delete|edit|add|remove|send|post|reply|comment|assign|close|reopen|resolve|transition|move|publish|archive|rename|import|invite|approve|reject|merge|write)/i

export class AccessDeniedError extends Error {
  readonly name = 'AccessDeniedError'
  constructor(toolName: string) {
    super(`Access denied: write operations require lead role (attempted: ${toolName})`)
  }
}

export const isWriteOperation = (toolName: string): boolean => WRITE_VERB_RE.test(toolName)

export const checkAccess = (toolName: string, userRole: Role): void => {
  if (isWriteOperation(toolName) && userRole === 'dev') {
    throw new AccessDeniedError(toolName)
  }
}
