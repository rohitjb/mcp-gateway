import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RoleCache } from './roleCache.js'
import type { RbacDeps } from './index.js'

// ─── RoleCache ────────────────────────────────────────────────────────────────

describe('RoleCache', () => {
  it('returns null for an email that has never been cached', () => {
    const cache = new RoleCache()
    expect(cache.get('unknown@example.com')).toBeNull()
  })

  it('returns the cached role immediately after set', () => {
    const cache = new RoleCache()
    cache.set('dev@example.com', 'dev')
    expect(cache.get('dev@example.com')).toBe('dev')
  })

  it('returns null after the TTL has elapsed', async () => {
    const cache = new RoleCache(50) // 50ms TTL for test speed
    cache.set('lead@example.com', 'lead')
    await new Promise(r => setTimeout(r, 60))
    expect(cache.get('lead@example.com')).toBeNull()
  })

  it('returns the role before the TTL has elapsed', async () => {
    const cache = new RoleCache(200)
    cache.set('dev@example.com', 'dev')
    await new Promise(r => setTimeout(r, 50))
    expect(cache.get('dev@example.com')).toBe('dev')
  })

  it('evicts the stale entry on get so it is gone from the map', async () => {
    const cache = new RoleCache(50)
    cache.set('stale@example.com', 'dev')
    await new Promise(r => setTimeout(r, 60))
    cache.get('stale@example.com') // triggers eviction
    // a second get should still return null (not resurrect the entry)
    expect(cache.get('stale@example.com')).toBeNull()
  })
})

// ─── getUserRole ──────────────────────────────────────────────────────────────

describe('getUserRole', () => {
  let deps: RbacDeps

  beforeEach(() => {
    deps = {
      fetchRole: vi.fn(),
      cache: new RoleCache(),
    }
  })

  it('fetches from Firestore on a cache miss and returns the role', async () => {
    vi.mocked(deps.fetchRole).mockResolvedValueOnce('dev')
    const { makeGetUserRole } = await import('./index.js')
    const getUserRole = makeGetUserRole(deps)
    const role = await getUserRole('dev@example.com')
    expect(role).toBe('dev')
    expect(deps.fetchRole).toHaveBeenCalledOnce()
    expect(deps.fetchRole).toHaveBeenCalledWith('dev@example.com')
  })

  it('returns cached role on second call without hitting Firestore again', async () => {
    vi.mocked(deps.fetchRole).mockResolvedValueOnce('lead')
    const { makeGetUserRole } = await import('./index.js')
    const getUserRole = makeGetUserRole(deps)
    await getUserRole('lead@example.com')
    const role = await getUserRole('lead@example.com')
    expect(role).toBe('lead')
    expect(deps.fetchRole).toHaveBeenCalledOnce() // not twice
  })

  it('throws when fetchRole throws (user not found in Firestore)', async () => {
    vi.mocked(deps.fetchRole).mockRejectedValueOnce(
      new Error('User not found: nobody@example.com'),
    )
    const { makeGetUserRole } = await import('./index.js')
    const getUserRole = makeGetUserRole(deps)
    await expect(getUserRole('nobody@example.com')).rejects.toThrow(
      'User not found: nobody@example.com',
    )
  })

  it('does not cache a role when fetchRole throws', async () => {
    vi.mocked(deps.fetchRole)
      .mockRejectedValueOnce(new Error('not found'))
      .mockResolvedValueOnce('dev')
    const { makeGetUserRole } = await import('./index.js')
    const getUserRole = makeGetUserRole(deps)
    await getUserRole('dev@example.com').catch(() => undefined)
    const role = await getUserRole('dev@example.com')
    expect(role).toBe('dev')
    expect(deps.fetchRole).toHaveBeenCalledTimes(2) // retried after failure
  })
})
