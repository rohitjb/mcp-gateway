import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('CLI dispatch', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>
  let exitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: string | number | null) => {
      throw new Error('process.exit called')
    })
  })

  afterEach(() => {
    consoleSpy.mockRestore()
    exitSpy.mockRestore()
  })

  it('serve subcommand is registered and exposes --config flag in help', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const { dispatch } = await import('./index.js')
    await expect(dispatch(['serve', '--help'])).rejects.toThrow('process.exit called')
    const output = stdoutSpy.mock.calls.flat().join(' ')
    stdoutSpy.mockRestore()
    expect(output).toMatch(/--config/)
  })

  it('shows help output when "--help" flag is given', async () => {
    const { dispatch } = await import('./index.js')
    await expect(dispatch(['--help'])).rejects.toThrow('process.exit called')
  })
})
