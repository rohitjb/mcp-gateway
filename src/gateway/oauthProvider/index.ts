import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { auth } from '@modelcontextprotocol/sdk/client/auth.js'
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type {
  OAuthClientMetadata,
  OAuthClientInformationMixed,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'

const OAUTH_DIR = join(homedir(), '.mcp-gateway', 'oauth')
const CALLBACK_PORT = 8765

export class GatewayOAuthProvider implements OAuthClientProvider {
  private _tokens?: OAuthTokens
  private _clientInfo?: OAuthClientInformationMixed
  private _codeVerifier?: string
  private readonly _tokenPath: string
  private readonly _clientPath: string
  private readonly _serverUrl: string
  private readonly _serverName: string
  private readonly _scope: string | undefined

  constructor(serverName: string, serverUrl: string, clientId?: string, scope?: string) {
    this._serverName = serverName
    this._serverUrl = serverUrl
    this._tokenPath = join(OAUTH_DIR, `${serverName}_tokens.json`)
    this._clientPath = join(OAUTH_DIR, `${serverName}_client.json`)
    this._scope = scope
    if (clientId) {
      this._clientInfo = { client_id: clientId }
    }
  }

  get redirectUrl(): string {
    return `http://localhost:${CALLBACK_PORT}/callback`
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'mcp-gateway',
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    if (this._clientInfo) return this._clientInfo
    try {
      const data = await readFile(this._clientPath, 'utf8')
      this._clientInfo = JSON.parse(data) as OAuthClientInformationMixed
      return this._clientInfo
    } catch {
      return undefined
    }
  }

  async saveClientInformation(info: OAuthClientInformationMixed): Promise<void> {
    this._clientInfo = info
    await mkdir(OAUTH_DIR, { recursive: true })
    await writeFile(this._clientPath, JSON.stringify(info))
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    if (this._tokens) return this._tokens
    try {
      const data = await readFile(this._tokenPath, 'utf8')
      this._tokens = JSON.parse(data) as OAuthTokens
      return this._tokens
    } catch {
      return undefined
    }
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    this._tokens = tokens
    await mkdir(OAUTH_DIR, { recursive: true })
    await writeFile(this._tokenPath, JSON.stringify(tokens))
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    if (this._scope !== undefined) {
      if (this._scope === '') {
        authorizationUrl.searchParams.delete('scope')
      } else {
        authorizationUrl.searchParams.set('scope', this._scope)
      }
    }

    process.stderr.write(
      `[gateway] OAuth required for "${this._serverName}". Opening browser...\n` +
      `[gateway] If browser doesn't open, visit: ${authorizationUrl}\n`,
    )

    const code = await new Promise<string>((resolve, reject) => {
      const server = createServer((req, res) => {
        if (!req.url) return
        const url = new URL(req.url, `http://localhost:${CALLBACK_PORT}`)
        if (url.pathname !== '/callback') return

        const code = url.searchParams.get('code')
        const error = url.searchParams.get('error')
        const html = code
          ? '<h1>Authorization successful! You can close this tab.</h1>'
          : `<h1>Authorization failed: ${error ?? 'unknown error'}</h1>`

        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(`<html><body>${html}</body></html>`)
        server.close()

        if (code) resolve(code)
        else reject(new Error(`OAuth authorization failed: ${error ?? 'unknown'}`))
      })

      server.listen(CALLBACK_PORT, async () => {
        try {
          const { default: open } = await import('open')
          await open(authorizationUrl.toString())
        } catch {
          // Browser open failed — user can visit the URL shown above manually
        }
      })

      server.on('error', (err: Error) => {
        reject(new Error(`OAuth callback server error: ${err.message}`))
      })
    })

    // Exchange authorization code for tokens and persist them.
    // After this returns, the next connection attempt will use the saved tokens.
    await auth(this, { serverUrl: this._serverUrl, authorizationCode: code })
    process.stderr.write(`[gateway] OAuth completed for "${this._serverName}"\n`)
  }

  async saveCodeVerifier(verifier: string): Promise<void> {
    this._codeVerifier = verifier
  }

  async codeVerifier(): Promise<string> {
    if (!this._codeVerifier) throw new Error('No code verifier saved')
    return this._codeVerifier
  }
}
