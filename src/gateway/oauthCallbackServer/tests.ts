import { describe, it, expect, afterEach } from 'vitest'
import http from 'node:http'
import { waitForOAuthCallback, OAUTH_CALLBACK_PORT } from './index.js'

const callbackUrl = (params: Record<string, string>) => {
  const url = new URL(`http://localhost:${OAUTH_CALLBACK_PORT}/callback`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return url.toString()
}

const hit = (url: string) =>
  new Promise<{ status: number; body: string }>((resolve, reject) => {
    http.get(url, res => {
      let body = ''
      res.on('data', (chunk: Buffer) => { body += chunk })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
    }).on('error', reject)
  })

describe('waitForOAuthCallback', () => {
  afterEach(async () => {
    await new Promise(r => setTimeout(r, 50))
  })

  it('resolves with code when callback hits with correct state', async () => {
    const promise = waitForOAuthCallback('state-abc')
    await hit(callbackUrl({ code: 'mycode', state: 'state-abc' }))
    await expect(promise).resolves.toBe('mycode')
  })

  it('rejects when callback returns error', async () => {
    const promise = waitForOAuthCallback('state-err')
    const assertion = expect(promise).rejects.toThrow('access_denied')
    await hit(callbackUrl({ error: 'access_denied', state: 'state-err' }))
    await assertion
  })

  it('routes two concurrent callbacks to correct waiters', async () => {
    const p1 = waitForOAuthCallback('state-1')
    const p2 = waitForOAuthCallback('state-2')

    await hit(callbackUrl({ code: 'code-for-2', state: 'state-2' }))
    await hit(callbackUrl({ code: 'code-for-1', state: 'state-1' }))

    await expect(p1).resolves.toBe('code-for-1')
    await expect(p2).resolves.toBe('code-for-2')
  })

  it('returns 400 for unknown state', async () => {
    const promise = waitForOAuthCallback('state-known')
    const { status } = await hit(callbackUrl({ code: 'x', state: 'unknown-state' }))
    expect(status).toBe(400)
    await hit(callbackUrl({ code: 'x', state: 'state-known' }))
    await promise
  })
})
