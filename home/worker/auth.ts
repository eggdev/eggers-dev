import { createRemoteJWKSet, jwtVerify } from 'jose'

export interface HomeIdentity {
  email: string
  local: boolean
}

const isLocalRequest = (url: URL): boolean =>
  url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'

let cachedIssuer = ''
let cachedJwks: ReturnType<typeof createRemoteJWKSet> | undefined

const getJwks = (issuer: string): ReturnType<typeof createRemoteJWKSet> => {
  if (!cachedJwks || cachedIssuer !== issuer) {
    cachedIssuer = issuer
    cachedJwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`))
  }
  return cachedJwks
}

export async function authenticate(request: Request, env: Env): Promise<HomeIdentity | null> {
  const url = new URL(request.url)
  const allowedEmails = env.ALLOWED_EMAILS.split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)

  if (isLocalRequest(url)) {
    return { email: allowedEmails[0] ?? 'local@eggers.dev', local: true }
  }

  const issuer = env.ACCESS_TEAM_DOMAIN.replace(/\/$/, '')
  if (
    issuer.includes('REPLACE_') ||
    env.ACCESS_AUD.includes('REPLACE_') ||
    allowedEmails.length === 0
  ) {
    console.error(JSON.stringify({ message: 'Home Access variables are not configured' }))
    return null
  }

  const token = request.headers.get('Cf-Access-Jwt-Assertion')
  if (!token) return null

  try {
    const { payload } = await jwtVerify(token, getJwks(issuer), {
      audience: env.ACCESS_AUD,
      issuer,
    })
    const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : ''
    return allowedEmails.includes(email) ? { email, local: false } : null
  } catch (error) {
    console.error(
      JSON.stringify({
        message: 'Cloudflare Access token validation failed',
        error: error instanceof Error ? error.message : String(error),
      })
    )
    return null
  }
}
