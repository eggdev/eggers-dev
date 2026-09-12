import { createRemoteJWKSet, jwtVerify } from 'jose'

export interface StudioIdentity {
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

export async function authenticate(request: Request, env: Env): Promise<StudioIdentity | null> {
  const url = new URL(request.url)
  if (isLocalRequest(url)) return { email: env.ALLOWED_EMAIL, local: true }

  const accessTeamDomain: string = env.ACCESS_TEAM_DOMAIN
  const accessAud: string = env.ACCESS_AUD
  if (accessTeamDomain.includes('REPLACE_ME') || accessAud === 'REPLACE_ME') {
    console.error(JSON.stringify({ message: 'Cloudflare Access variables are not configured' }))
    return null
  }

  const token = request.headers.get('Cf-Access-Jwt-Assertion')
  if (!token) return null

  const issuer = accessTeamDomain.replace(/\/$/, '')
  try {
    const { payload } = await jwtVerify(token, getJwks(issuer), {
      audience: accessAud,
      issuer,
    })
    return typeof payload.email === 'string' &&
      payload.email.toLowerCase() === env.ALLOWED_EMAIL.toLowerCase()
      ? { email: payload.email, local: false }
      : null
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
