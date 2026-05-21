import { createServer, type Server } from 'node:http'

export const OAUTH_CALLBACK_PORT = 8765

type PendingCallback = {
  resolve: (code: string) => void
  reject: (err: Error) => void
}

const pending = new Map<string, PendingCallback>()
let server: Server | null = null

const stopServer = () => {
  server?.close()
  server = null
}

const startServer = () => {
  server = createServer((req, res) => {
    if (!req.url) { res.writeHead(400); res.end(); return }
    const url = new URL(req.url, `http://localhost:${OAUTH_CALLBACK_PORT}`)
    if (url.pathname !== '/callback') { res.writeHead(404); res.end(); return }

    const code = url.searchParams.get('code')
    const error = url.searchParams.get('error')
    const state = url.searchParams.get('state') ?? ''
    const waiter = pending.get(state)

    if (!waiter) {
      res.writeHead(400, { 'Content-Type': 'text/html' })
      res.end('<html><body><h1>Unknown OAuth state — try re-authorizing.</h1></body></html>')
      return
    }

    pending.delete(state)
    if (pending.size === 0) stopServer()

    const html = code
      ? '<h1>Authorization successful! You can close this tab.</h1>'
      : `<h1>Authorization failed: ${error ?? 'unknown error'}</h1>`
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(`<html><body>${html}</body></html>`)

    if (code) waiter.resolve(code)
    else waiter.reject(new Error(`OAuth authorization failed: ${error ?? 'unknown'}`))
  })

  server.on('error', (err: Error) => {
    for (const waiter of pending.values()) {
      waiter.reject(new Error(`OAuth callback server error: ${err.message}`))
    }
    pending.clear()
    server = null
  })

  server.listen(OAUTH_CALLBACK_PORT)
}

export const waitForOAuthCallback = (state: string): Promise<string> => {
  if (!server) startServer()
  return new Promise<string>((resolve, reject) => {
    pending.set(state, { resolve, reject })
  })
}
