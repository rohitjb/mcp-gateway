import { describe, it, expect } from 'vitest'
import { isWriteOperation, checkAccess, AccessDeniedError } from './rbac.js'

describe('isWriteOperation', () => {
  it.each([
    'atlassian_create_issue',
    'atlassian_update_issue',
    'atlassian_create_page',
    'atlassian_update_page',
    'atlassian_add_comment',
    'atlassian_create_comment',
    'atlassian_delete_issue',
    'atlassian_edit_issue',
    'atlassian_resolve_issue',
    'atlassian_assign_issue',
    'teams_send_message',
    'teams_send_channel_message',
    'teams_reply_message',
    'github_create_issue',
    'github_merge_pull_request',
  ])('returns true for write tool: %s', (tool) => {
    expect(isWriteOperation(tool)).toBe(true)
  })

  it.each([
    'atlassian_search_issues',
    'atlassian_get_issue',
    'atlassian_list_pages',
    'atlassian_get_page',
    'firebase_get_crashes',
    'firebase_get_analytics',
    'teams_list_channels',
    'teams_get_messages',
    'github_list_issues',
    'github_get_pull_request',
    'search_all',
  ])('returns false for read tool: %s', (tool) => {
    expect(isWriteOperation(tool)).toBe(false)
  })

  it('returns false for unknown tools (fail-open on classification)', () => {
    expect(isWriteOperation('unknown_tool_xyz')).toBe(false)
  })
})

describe('checkAccess', () => {
  it('throws AccessDeniedError when a dev tries a write operation', () => {
    expect(() => checkAccess('atlassian_create_issue', 'dev')).toThrow(AccessDeniedError)
  })

  it('error message names the tool and explains the role requirement', () => {
    expect(() => checkAccess('teams_send_message', 'dev')).toThrow(
      'Access denied: write operations require lead role (attempted: teams_send_message)',
    )
  })

  it('allows dev to call read operations', () => {
    expect(() => checkAccess('atlassian_search_issues', 'dev')).not.toThrow()
  })

  it('allows lead to call write operations', () => {
    expect(() => checkAccess('atlassian_create_issue', 'lead')).not.toThrow()
  })

  it('allows lead to call read operations', () => {
    expect(() => checkAccess('firebase_get_crashes', 'lead')).not.toThrow()
  })
})

describe('AccessDeniedError', () => {
  it('is instanceof Error', () => {
    expect(new AccessDeniedError('tool')).toBeInstanceOf(Error)
  })

  it('has name "AccessDeniedError"', () => {
    expect(new AccessDeniedError('tool').name).toBe('AccessDeniedError')
  })
})
