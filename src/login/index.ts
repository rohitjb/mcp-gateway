import { createServer } from 'node:http'
import { writeFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

// Public installed-app OAuth2 credentials (same as gcloud CLI — designed for this use case)
const GOOGLE_CLIENT_ID = '764086051850-6qr4p6gpi6hn506pt8ejuq83di341hur.apps.googleusercontent.com'
const GOOGLE_CLIENT_SECRET = 'd-FL95Q19q7MQmFpd7hHD0Ty'
const SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/datastore',
  'https://www.googleapis.com/auth/firebase',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
]

const getFreePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const srv = createServer()
    srv.listen(0, () => {
      const addr = srv.address()
      srv.close(() => resolve((addr as { port: number }).port))
    })
    srv.on('error', reject)
  })

const waitForAuthCode = (port: number): Promise<string> =>
  new Promise((resolve, reject) => {
    const srv = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${port}`)
      const code = url.searchParams.get('code')
      const error = url.searchParams.get('error')
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<html><body><h2>Authentication successful — you can close this tab.</h2></body></html>')
      srv.close()
      if (error) reject(new Error(`OAuth error: ${error}`))
      else if (code) resolve(code)
      else reject(new Error('No auth code received'))
    })
    srv.listen(port)
  })

export const runGoogleLogin = async (): Promise<void> => {
  const { default: open } = await import('open')
  const port = await getFreePort()
  const redirectUri = `http://localhost:${port}`

  const authUrl = new URL('https://accounts.google.com/o/oauth2/auth')
  authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', SCOPES.join(' '))
  authUrl.searchParams.set('access_type', 'offline')
  authUrl.searchParams.set('prompt', 'consent')

  process.stdout.write(`Opening browser for Google authentication...\n`)
  await open(authUrl.toString())
  process.stdout.write(`Waiting for authentication (browser should have opened)...\n`)

  const code = await waitForAuthCode(port)

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })

  const tokens = await tokenRes.json() as { refresh_token?: string; error?: string }
  if (tokens.error ?? !tokens.refresh_token) {
    throw new Error(`Token exchange failed: ${tokens.error ?? 'no refresh_token returned'}`)
  }

  const adcDir = join(homedir(), '.config', 'gcloud')
  const adcPath = join(adcDir, 'application_default_credentials.json')
  await mkdir(adcDir, { recursive: true })
  await writeFile(adcPath, JSON.stringify({
    account: '',
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    refresh_token: tokens.refresh_token,
    type: 'authorized_user',
    universe_domain: 'googleapis.com',
  }, null, 2))

  process.stdout.write(`Credentials saved. You can now start the MCP gateway.\n`)
}
