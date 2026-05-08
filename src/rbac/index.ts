import type { Role, RoleCache } from './roleCache.js'

export type { Role }

export interface RbacDeps {
  fetchRole: (email: string) => Promise<Role>
  cache: RoleCache
}

export const makeGetUserRole =
  (deps: RbacDeps) =>
  async (email: string): Promise<Role> => {
    const cached = deps.cache.get(email)
    if (cached !== null) return cached

    const role = await deps.fetchRole(email)
    deps.cache.set(email, role)
    return role
  }
