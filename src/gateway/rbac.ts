import type { Role } from '../rbac/roleCache.js'

// Write operations per service — Firebase has none (read-only Crashlytics/Analytics)
const WRITE_TOOLS = new Set<string>([
  'atlassian_create_issue',
  'atlassian_update_issue',
  'atlassian_create_page',
  'atlassian_update_page',
  'teams_send_message',
  'teams_send_channel_message',
])

export class AccessDeniedError extends Error {
  readonly name = 'AccessDeniedError'
  constructor(toolName: string) {
    super(`Access denied: write operations require lead role (attempted: ${toolName})`)
  }
}

export const isWriteOperation = (toolName: string): boolean => WRITE_TOOLS.has(toolName)

export const checkAccess = (toolName: string, userRole: Role): void => {
  if (isWriteOperation(toolName) && userRole === 'dev') {
    throw new AccessDeniedError(toolName)
  }
}
