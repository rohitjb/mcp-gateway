export type Role = 'dev' | 'lead'

interface CacheEntry {
  readonly role: Role
  readonly fetchedAt: number
}

export class RoleCache {
  private readonly map = new Map<string, CacheEntry>()
  private readonly ttlMs: number

  constructor(ttlMs = 60_000) {
    this.ttlMs = ttlMs
  }

  get(email: string): Role | null {
    const entry = this.map.get(email)
    if (!entry) return null
    if (Date.now() - entry.fetchedAt > this.ttlMs) {
      this.map.delete(email)
      return null
    }
    return entry.role
  }

  set(email: string, role: Role): void {
    this.map.set(email, { role, fetchedAt: Date.now() })
  }
}
