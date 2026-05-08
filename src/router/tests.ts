import { describe, it, expect, vi } from 'vitest'
import type { SearchAllDeps } from './index.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

const makeResult = (text: string, isEmpty = false): CallToolResult => ({
  content: isEmpty ? [] : [{ type: 'text', text }],
  isError: false,
})

const makeErrorResult = (): CallToolResult => ({
  content: [{ type: 'text', text: 'error' }],
  isError: true,
})

const baseDeps = (): SearchAllDeps => ({
  classify: vi.fn(),
  callBackendSearch: vi.fn(),
})

describe('searchAll', () => {
  it('classifies the query and calls the first backend in order', async () => {
    const { searchAll } = await import('./index.js')
    const deps = baseDeps()
    vi.mocked(deps.classify).mockResolvedValue(['firebase', 'atlassian', 'teams'])
    vi.mocked(deps.callBackendSearch).mockResolvedValue(makeResult('crash data'))

    const result = await searchAll('top crashes', deps)

    expect(deps.classify).toHaveBeenCalledWith('top crashes')
    expect(deps.callBackendSearch).toHaveBeenCalledWith('firebase', 'top crashes')
    expect((result.content[0] as { type: string; text: string }).text).toBe('crash data')
  })

  it('falls through to the next backend when the first returns an error result', async () => {
    const { searchAll } = await import('./index.js')
    const deps = baseDeps()
    vi.mocked(deps.classify).mockResolvedValue(['firebase', 'atlassian', 'teams'])
    vi.mocked(deps.callBackendSearch)
      .mockResolvedValueOnce(makeErrorResult())
      .mockResolvedValueOnce(makeResult('jira issues'))

    const result = await searchAll("sprint tasks", deps)

    expect(deps.callBackendSearch).toHaveBeenCalledTimes(2)
    expect(deps.callBackendSearch).toHaveBeenNthCalledWith(2, 'atlassian', "sprint tasks")
    expect((result.content[0] as { type: string; text: string }).text).toBe('jira issues')
  })

  it('falls through to the next backend when the first throws', async () => {
    const { searchAll } = await import('./index.js')
    const deps = baseDeps()
    vi.mocked(deps.classify).mockResolvedValue(['firebase', 'atlassian'])
    vi.mocked(deps.callBackendSearch)
      .mockRejectedValueOnce(new Error('Backend down'))
      .mockResolvedValueOnce(makeResult('jira data'))

    const result = await searchAll('query', deps)

    expect(deps.callBackendSearch).toHaveBeenCalledTimes(2)
    expect((result.content[0] as { type: string; text: string }).text).toBe('jira data')
  })

  it('falls through when a backend returns empty content', async () => {
    const { searchAll } = await import('./index.js')
    const deps = baseDeps()
    vi.mocked(deps.classify).mockResolvedValue(['firebase', 'teams'])
    vi.mocked(deps.callBackendSearch)
      .mockResolvedValueOnce(makeResult('', true))
      .mockResolvedValueOnce(makeResult('channel messages'))

    const result = await searchAll('query', deps)

    expect(deps.callBackendSearch).toHaveBeenCalledTimes(2)
    expect((result.content[0] as { type: string; text: string }).text).toBe('channel messages')
  })

  it('returns a "no results" message when all backends fail', async () => {
    const { searchAll } = await import('./index.js')
    const deps = baseDeps()
    vi.mocked(deps.classify).mockResolvedValue(['firebase', 'atlassian', 'teams'])
    vi.mocked(deps.callBackendSearch).mockRejectedValue(new Error('down'))

    const result = await searchAll('query', deps)

    expect(result.isError).toBe(false)
    const text = (result.content[0] as { type: string; text: string }).text
    expect(text).toContain('No results found')
  })

  it('returns a "no results" message when classify returns empty list', async () => {
    const { searchAll } = await import('./index.js')
    const deps = baseDeps()
    vi.mocked(deps.classify).mockResolvedValue([])

    const result = await searchAll('gibberish query', deps)

    expect(deps.callBackendSearch).not.toHaveBeenCalled()
    const text = (result.content[0] as { type: string; text: string }).text
    expect(text).toContain('No results found')
  })
})
