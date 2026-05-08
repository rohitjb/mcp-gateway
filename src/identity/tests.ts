import { describe, it, expect, vi } from 'vitest'
import type { DetectDeps } from './detect.js'

const makeExec =
  (map: Record<string, string>): DetectDeps['exec'] =>
  async (cmd, args) => {
    const key = [cmd, ...args].join(' ')
    const value = map[key]
    if (value === undefined) throw new Error(`exec: command not found: ${key}`)
    return value
  }

describe('detectIdentity', () => {
  it('returns email from GATEWAY_USER_EMAIL env var when set', async () => {
    vi.stubEnv('GATEWAY_USER_EMAIL', 'env@example.com')
    const { detectIdentity } = await import('./detect.js')
    const result = await detectIdentity({ exec: makeExec({}) })
    expect(result.email).toBe('env@example.com')
    vi.unstubAllEnvs()
  })

  it('falls through to git config when GATEWAY_USER_EMAIL is not set', async () => {
    vi.stubEnv('GATEWAY_USER_EMAIL', '')
    const { detectIdentity } = await import('./detect.js')
    const result = await detectIdentity({
      exec: makeExec({ 'git config --global user.email': 'git@example.com\n' }),
    })
    expect(result.email).toBe('git@example.com')
    vi.unstubAllEnvs()
  })

  it('falls through to gh api when git config is empty', async () => {
    vi.stubEnv('GATEWAY_USER_EMAIL', '')
    const { detectIdentity } = await import('./detect.js')
    const result = await detectIdentity({
      exec: makeExec({
        'git config --global user.email': '',
        'gh api user --jq .email': '"gh@example.com"\n',
      }),
    })
    expect(result.email).toBe('gh@example.com')
    vi.unstubAllEnvs()
  })

  it('falls through to gh api when git config throws', async () => {
    vi.stubEnv('GATEWAY_USER_EMAIL', '')
    const { detectIdentity } = await import('./detect.js')
    const result = await detectIdentity({
      exec: makeExec({ 'gh api user --jq .email': '"gh@example.com"' }),
    })
    expect(result.email).toBe('gh@example.com')
    vi.unstubAllEnvs()
  })

  it('throws when all sources fail', async () => {
    vi.stubEnv('GATEWAY_USER_EMAIL', '')
    const { detectIdentity } = await import('./detect.js')
    await expect(
      detectIdentity({ exec: makeExec({}) }),
    ).rejects.toThrow('Identity not found. Set GATEWAY_USER_EMAIL or configure git user.email.')
    vi.unstubAllEnvs()
  })

  it('skips gh api "null" response and throws', async () => {
    vi.stubEnv('GATEWAY_USER_EMAIL', '')
    const { detectIdentity } = await import('./detect.js')
    await expect(
      detectIdentity({
        exec: makeExec({
          'git config --global user.email': '',
          'gh api user --jq .email': 'null',
        }),
      }),
    ).rejects.toThrow('Identity not found. Set GATEWAY_USER_EMAIL or configure git user.email.')
    vi.unstubAllEnvs()
  })
})
