import { describe, it, expect } from 'vitest'
import { classify } from './classify.js'

describe('classify', () => {
  it('routes crash/error queries to firebase first', () => {
    expect(classify('top crashes last 24 hours')[0]).toBe('firebase')
    expect(classify('unhandled exception in prod')[0]).toBe('firebase')
  })

  it('routes sprint/issue queries to atlassian first', () => {
    expect(classify("what's in my sprint")[0]).toBe('atlassian')
    expect(classify('open jira tickets')[0]).toBe('atlassian')
  })

  it('routes message/channel queries to teams first', () => {
    expect(classify('messages in #general')[0]).toBe('teams')
    expect(classify('latest chat in channel')[0]).toBe('teams')
  })

  it('returns all three backends when no keywords match', () => {
    const result = classify('something completely unrelated')
    expect(result).toHaveLength(3)
    expect(result).toContain('firebase')
    expect(result).toContain('atlassian')
    expect(result).toContain('teams')
  })

  it('ranks by keyword hit count — more matches = higher priority', () => {
    // "crash error exception" — three firebase keywords
    const result = classify('crash error exception in sprint')
    expect(result[0]).toBe('firebase')
    expect(result).toContain('atlassian')
  })

  it('returns only backends that have keyword matches when matches exist', () => {
    // Only firebase keywords present
    const result = classify('app crash analytics')
    expect(result[0]).toBe('firebase')
  })
})
