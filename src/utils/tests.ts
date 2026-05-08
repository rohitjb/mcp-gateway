import { describe, it, expect, vi, afterEach } from 'vitest'

describe('execFile wrapper', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns trimmed stdout from a successful command', async () => {
    const { execFile } = await import('./exec.js')
    const result = await execFile('echo', ['hello'])
    expect(result).toBe('hello')
  })

  it('rejects when the command exits non-zero', async () => {
    const { execFile } = await import('./exec.js')
    await expect(execFile('false', [])).rejects.toThrow()
  })

  it('rejects with stderr message when command is not found', async () => {
    const { execFile } = await import('./exec.js')
    await expect(execFile('this-command-does-not-exist-xyz', [])).rejects.toThrow()
  })
})
