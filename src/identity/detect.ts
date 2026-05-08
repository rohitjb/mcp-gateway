import type { Identity } from '../types.js'

export interface DetectDeps {
  exec: (cmd: string, args: string[]) => Promise<string>
}

const stripJsonQuotes = (value: string): string => {
  const trimmed = value.trim()
  return trimmed.startsWith('"') && trimmed.endsWith('"')
    ? trimmed.slice(1, -1)
    : trimmed
}

export const detectIdentity = async (deps: DetectDeps): Promise<Identity> => {
  // 1. Env var — simplest path for local dev and CI
  const envEmail = process.env['GATEWAY_USER_EMAIL']?.trim()
  if (envEmail) return { email: envEmail }

  // 2. git config --global user.email
  try {
    const email = (await deps.exec('git', ['config', '--global', 'user.email'])).trim()
    if (email) return { email }
  } catch {
    // git not installed or no email configured — fall through
  }

  // 3. gh api user --jq .email
  try {
    const raw = (await deps.exec('gh', ['api', 'user', '--jq', '.email'])).trim()
    const email = stripJsonQuotes(raw)
    if (email && email !== 'null') return { email }
  } catch {
    // gh not installed or not authenticated — fall through
  }

  throw new Error('Identity not found. Set GATEWAY_USER_EMAIL or configure git user.email.')
}
